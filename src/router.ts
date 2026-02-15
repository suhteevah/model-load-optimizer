/**
 * Model Router - The brain of the optimizer.
 *
 * Decides which Ollama model to use for each request based on:
 * 1. Model availability (pulled + loaded status)
 * 2. GPU VRAM utilization (nvidia-smi)
 * 3. System RAM availability
 * 4. Model warm/cold state (prefer already-loaded models)
 * 5. Request complexity heuristics (message length, conversation depth)
 */

import type { PluginConfig } from "./config.js";
import { OllamaClient, type ModelStatus } from "./ollama-client.js";
import { getNvidiaVramUsage, getNvidiaGpuUtilization } from "./gpu-detect.js";

export type RouteDecision = {
  model: string;
  reason: string;
  source: "primary" | "sidecar" | "fallback";
  gpuUtilization?: number;
  vramUsedMB?: number;
  vramTotalMB?: number;
  modelLoaded: boolean;
  timestamp: number;
};

export type RouterState = {
  lastDecision?: RouteDecision;
  primaryStatus: ModelStatus;
  sidecarStatus: ModelStatus;
  gpuUtilization: number | null;
  vramUsage: { usedMB: number; totalMB: number } | null;
  ollamaReachable: boolean;
  lastHealthCheck: number;
  decisionsCount: number;
  primarySelections: number;
  sidecarSelections: number;
  fallbackSelections: number;
};

export class ModelRouter {
  private client: OllamaClient;
  private config: PluginConfig;
  private state: RouterState;
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  constructor(client: OllamaClient, config: PluginConfig) {
    this.client = client;
    this.config = config;
    this.state = {
      primaryStatus: {
        name: config.primaryModel,
        pulled: false,
        loaded: false,
        sizeBytes: 0,
        vramBytes: 0,
      },
      sidecarStatus: {
        name: config.sidecarModel,
        pulled: false,
        loaded: false,
        sizeBytes: 0,
        vramBytes: 0,
      },
      gpuUtilization: null,
      vramUsage: null,
      ollamaReachable: false,
      lastHealthCheck: 0,
      decisionsCount: 0,
      primarySelections: 0,
      sidecarSelections: 0,
      fallbackSelections: 0,
    };
  }

  getState(): RouterState {
    return { ...this.state };
  }

  /**
   * Start periodic health checking.
   */
  async start(): Promise<void> {
    await this.refreshHealth();

    this.healthInterval = setInterval(
      () => this.refreshHealth(),
      this.config.healthCheckIntervalSec * 1000
    );

    // Preload primary model if configured
    if (this.config.preloadOnStart && this.state.primaryStatus.pulled) {
      await this.client.warmModel(
        this.config.primaryModel,
        this.config.keepAliveMinutes
      );
    }
  }

  /**
   * Stop health checking.
   */
  stop(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  /**
   * Refresh all health metrics.
   */
  async refreshHealth(): Promise<void> {
    const health = await this.client.checkHealth();

    this.state.ollamaReachable = health.reachable;
    this.state.lastHealthCheck = Date.now();
    this.state.primaryStatus = this.client.getModelStatus(this.config.primaryModel);
    this.state.sidecarStatus = this.client.getModelStatus(this.config.sidecarModel);

    // GPU metrics (nvidia-smi)
    this.state.gpuUtilization = getNvidiaGpuUtilization();
    this.state.vramUsage = getNvidiaVramUsage();
  }

  /**
   * Select the optimal model for a request.
   *
   * Decision priority:
   * 1. If Ollama is unreachable -> remote fallback
   * 2. If primary is pulled + GPU has capacity -> primary
   * 3. If GPU is overloaded but sidecar is available -> sidecar (CPU-only)
   * 4. If primary isn't pulled but sidecar is -> sidecar
   * 5. If nothing local works -> remote fallback
   */
  async selectModel(context?: {
    messageLength?: number;
    conversationDepth?: number;
    forceModel?: string;
  }): Promise<RouteDecision> {
    // Force override
    if (context?.forceModel) {
      const decision: RouteDecision = {
        model: context.forceModel,
        reason: "Forced model selection",
        source: "primary",
        modelLoaded: this.client.isModelLoaded(context.forceModel),
        timestamp: Date.now(),
      };
      this.state.lastDecision = decision;
      return decision;
    }

    // Ensure health is fresh enough
    if (Date.now() - this.state.lastHealthCheck > this.config.healthCheckIntervalSec * 1000 * 2) {
      await this.refreshHealth();
    }

    // If Ollama is down, go remote
    if (!this.state.ollamaReachable) {
      return this.decideFallback("Ollama is unreachable");
    }

    const primaryPulled = this.state.primaryStatus.pulled;
    const sidecarPulled = this.state.sidecarStatus.pulled;
    const primaryLoaded = this.state.primaryStatus.loaded;
    const sidecarLoaded = this.state.sidecarStatus.loaded;

    // Check GPU load
    const gpuOverloaded = this.isGpuOverloaded();

    // Check if this is a "simple" request that the sidecar can handle
    const isSimpleRequest = this.isSimpleRequest(context);

    // ── Decision Logic ──────────────────────────────────────────

    // If primary is already loaded and GPU isn't overloaded -> use it
    if (primaryPulled && primaryLoaded && !gpuOverloaded) {
      return this.decidePrimary("Primary model loaded and GPU has capacity");
    }

    // If primary is pulled but not loaded, and GPU has room -> load + use it
    if (primaryPulled && !gpuOverloaded && !isSimpleRequest) {
      return this.decidePrimary("Primary model available, loading for complex request");
    }

    // If GPU is overloaded or simple request, prefer sidecar if available
    if (sidecarPulled && (gpuOverloaded || isSimpleRequest)) {
      const reason = gpuOverloaded
        ? `GPU VRAM above ${(this.config.gpuMemoryThreshold * 100).toFixed(0)}% - routing to CPU sidecar`
        : "Simple request routed to fast CPU sidecar";
      return this.decideSidecar(reason);
    }

    // If sidecar is loaded (already warm), use it as fast path
    if (sidecarPulled && sidecarLoaded) {
      return this.decideSidecar("Sidecar already loaded - fast response path");
    }

    // If primary is available at all, use it (even if GPU is loaded, partial offload works)
    if (primaryPulled) {
      return this.decidePrimary("Primary model available with partial GPU offload");
    }

    // Last resort: sidecar
    if (sidecarPulled) {
      return this.decideSidecar("Only sidecar model available");
    }

    // Nothing local -> fallback to remote
    return this.decideFallback("No local models available");
  }

  /**
   * Check if GPU VRAM usage exceeds the configured threshold.
   */
  private isGpuOverloaded(): boolean {
    if (!this.state.vramUsage) return false;
    const ratio = this.state.vramUsage.usedMB / this.state.vramUsage.totalMB;
    return ratio >= this.config.gpuMemoryThreshold;
  }

  /**
   * Heuristic: is this a "simple" request the sidecar can handle?
   * Simple = short message, shallow conversation.
   */
  private isSimpleRequest(context?: {
    messageLength?: number;
    conversationDepth?: number;
  }): boolean {
    if (!context) return false;
    const shortMessage = (context.messageLength ?? 0) < 200;
    const shallowConversation = (context.conversationDepth ?? 0) < 3;
    return shortMessage && shallowConversation;
  }

  private decidePrimary(reason: string): RouteDecision {
    this.state.decisionsCount++;
    this.state.primarySelections++;
    const decision: RouteDecision = {
      model: `ollama/${this.config.primaryModel}`,
      reason,
      source: "primary",
      gpuUtilization: this.state.gpuUtilization ?? undefined,
      vramUsedMB: this.state.vramUsage?.usedMB,
      vramTotalMB: this.state.vramUsage?.totalMB,
      modelLoaded: this.state.primaryStatus.loaded,
      timestamp: Date.now(),
    };
    this.state.lastDecision = decision;
    return decision;
  }

  private decideSidecar(reason: string): RouteDecision {
    this.state.decisionsCount++;
    this.state.sidecarSelections++;
    const decision: RouteDecision = {
      model: `ollama/${this.config.sidecarModel}`,
      reason,
      source: "sidecar",
      gpuUtilization: this.state.gpuUtilization ?? undefined,
      vramUsedMB: this.state.vramUsage?.usedMB,
      vramTotalMB: this.state.vramUsage?.totalMB,
      modelLoaded: this.state.sidecarStatus.loaded,
      timestamp: Date.now(),
    };
    this.state.lastDecision = decision;
    return decision;
  }

  private decideFallback(reason: string): RouteDecision {
    this.state.decisionsCount++;
    this.state.fallbackSelections++;
    const model = this.config.fallbackModel ?? "anthropic/claude-sonnet-4-5";
    const decision: RouteDecision = {
      model,
      reason,
      source: "fallback",
      gpuUtilization: this.state.gpuUtilization ?? undefined,
      modelLoaded: false,
      timestamp: Date.now(),
    };
    this.state.lastDecision = decision;
    return decision;
  }
}

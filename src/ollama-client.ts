/**
 * Ollama HTTP API client.
 * Handles model listing, status checks, GPU metrics, keep-alive, and preloading.
 */

export type OllamaModel = {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
};

export type OllamaRunningModel = {
  name: string;
  model: string;
  size: number;
  digest: string;
  expires_at: string;
  size_vram: number;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
};

export type ModelStatus = {
  name: string;
  pulled: boolean;
  loaded: boolean;
  sizeBytes: number;
  vramBytes: number;
  expiresAt?: Date;
  parameterSize?: string;
  quantization?: string;
  family?: string;
};

export type OllamaHealth = {
  reachable: boolean;
  version?: string;
  pulledModels: OllamaModel[];
  runningModels: OllamaRunningModel[];
  lastChecked: number;
};

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export class OllamaClient {
  private host: string;
  private _health: OllamaHealth = {
    reachable: false,
    pulledModels: [],
    runningModels: [],
    lastChecked: 0,
  };

  constructor(host: string) {
    this.host = host.replace(/\/$/, "");
  }

  get health(): OllamaHealth {
    return this._health;
  }

  /**
   * Full health check: version, pulled models, running models.
   */
  async checkHealth(): Promise<OllamaHealth> {
    try {
      // Check version (basic reachability)
      const versionData = await fetchJson<{ version: string }>(
        `${this.host}/api/version`
      );

      // List pulled models
      const tagsData = await fetchJson<{ models: OllamaModel[] }>(
        `${this.host}/api/tags`
      );

      // List running (loaded) models
      const psData = await fetchJson<{ models: OllamaRunningModel[] }>(
        `${this.host}/api/ps`
      );

      this._health = {
        reachable: true,
        version: versionData.version,
        pulledModels: tagsData.models ?? [],
        runningModels: psData.models ?? [],
        lastChecked: Date.now(),
      };
    } catch {
      this._health = {
        reachable: false,
        pulledModels: this._health.pulledModels,
        runningModels: [],
        lastChecked: Date.now(),
      };
    }

    return this._health;
  }

  /**
   * Check if a model is pulled (available on disk).
   */
  isModelPulled(modelName: string): boolean {
    return this._health.pulledModels.some(
      (m) => m.name === modelName || m.model === modelName
    );
  }

  /**
   * Check if a model is currently loaded in memory.
   */
  isModelLoaded(modelName: string): boolean {
    return this._health.runningModels.some(
      (m) => m.name === modelName || m.model === modelName
    );
  }

  /**
   * Get detailed status for a specific model.
   */
  getModelStatus(modelName: string): ModelStatus {
    const pulled = this._health.pulledModels.find(
      (m) => m.name === modelName || m.model === modelName
    );
    const running = this._health.runningModels.find(
      (m) => m.name === modelName || m.model === modelName
    );

    return {
      name: modelName,
      pulled: !!pulled,
      loaded: !!running,
      sizeBytes: pulled?.size ?? running?.size ?? 0,
      vramBytes: running?.size_vram ?? 0,
      expiresAt: running?.expires_at ? new Date(running.expires_at) : undefined,
      parameterSize: (pulled?.details ?? running?.details)?.parameter_size,
      quantization: (pulled?.details ?? running?.details)?.quantization_level,
      family: (pulled?.details ?? running?.details)?.family,
    };
  }

  /**
   * Send a minimal generate request to warm up / keep alive a model.
   * Uses keep_alive parameter to control how long it stays loaded.
   */
  async warmModel(modelName: string, keepAliveMinutes: number): Promise<boolean> {
    try {
      const keepAlive = `${keepAliveMinutes}m`;
      await fetchJson(`${this.host}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          prompt: "",
          keep_alive: keepAlive,
          stream: false,
        }),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Compute total VRAM usage across all loaded models.
   */
  getTotalVramUsage(): { totalVram: number; modelCount: number } {
    let totalVram = 0;
    for (const m of this._health.runningModels) {
      totalVram += m.size_vram ?? 0;
    }
    return { totalVram, modelCount: this._health.runningModels.length };
  }

  /**
   * Get GPU utilization ratio (estimated from VRAM usage of loaded models).
   * Returns a number 0.0-1.0 based on how much VRAM is allocated.
   * Note: This is a heuristic based on model sizes vs GPU VRAM capacity.
   */
  estimateGpuLoad(gpuVramBytes: number): number {
    if (gpuVramBytes <= 0) return 0;
    const { totalVram } = this.getTotalVramUsage();
    return Math.min(totalVram / gpuVramBytes, 1.0);
  }
}

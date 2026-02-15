/**
 * /model-status chat command.
 * Shows current model routing status, GPU metrics, and loaded models.
 */

import type { PluginConfig } from "../config.js";
import type { ModelRouter } from "../router.js";
import type { OllamaClient } from "../ollama-client.js";

type CommandContext = {
  args?: string[];
  body?: string;
  channel?: string;
  channelId?: string;
};

export function createModelStatusCommand(
  router: ModelRouter,
  client: OllamaClient,
  config: PluginConfig
) {
  return {
    name: "model-status",
    description: "Show model load optimizer status, GPU metrics, and loaded models",
    acceptsArgs: true,

    handler: async (ctx: CommandContext): Promise<{ text: string }> => {
      const args = ctx.args ?? (ctx.body ? ctx.body.split(/\s+/) : []);

      if (args[0] === "refresh" || args[0] === "r") {
        await router.refreshHealth();
      }

      const state = router.getState();
      const health = client.health;
      const lines: string[] = [];

      // Header
      lines.push("## Model Load Optimizer Status");
      lines.push("");

      // Ollama status
      if (state.ollamaReachable) {
        lines.push(`**Ollama:** Online (v${health.version ?? "?"})`);
        lines.push(
          `**Endpoint:** ${config.ollamaHost}`
        );
      } else {
        lines.push("**Ollama:** OFFLINE");
        lines.push(
          `**Endpoint:** ${config.ollamaHost} (unreachable)`
        );
      }
      lines.push("");

      // GPU metrics
      if (state.vramUsage) {
        const pct = (
          (state.vramUsage.usedMB / state.vramUsage.totalMB) *
          100
        ).toFixed(1);
        const bar = formatBar(
          state.vramUsage.usedMB / state.vramUsage.totalMB
        );
        lines.push(
          `**GPU VRAM:** ${state.vramUsage.usedMB}MB / ${state.vramUsage.totalMB}MB (${pct}%) ${bar}`
        );
      }
      if (state.gpuUtilization !== null) {
        lines.push(
          `**GPU Compute:** ${state.gpuUtilization}% ${formatBar(state.gpuUtilization / 100)}`
        );
      }
      lines.push("");

      // Model status
      lines.push("### Models");
      lines.push("");
      lines.push(formatModelLine("Primary", config.primaryModel, state.primaryStatus));
      lines.push(formatModelLine("Sidecar", config.sidecarModel, state.sidecarStatus));
      if (config.fallbackModel) {
        lines.push(`- **Fallback (remote):** ${config.fallbackModel}`);
      }
      lines.push("");

      // Routing stats
      lines.push("### Routing Stats");
      lines.push(`- Total decisions: ${state.decisionsCount}`);
      lines.push(`- Primary selections: ${state.primarySelections}`);
      lines.push(`- Sidecar selections: ${state.sidecarSelections}`);
      lines.push(`- Fallback selections: ${state.fallbackSelections}`);
      lines.push("");

      // Last decision
      if (state.lastDecision) {
        lines.push("### Last Decision");
        lines.push(`- Model: ${state.lastDecision.model}`);
        lines.push(`- Reason: ${state.lastDecision.reason}`);
        lines.push(`- Source: ${state.lastDecision.source}`);
        const ago = Math.round(
          (Date.now() - state.lastDecision.timestamp) / 1000
        );
        lines.push(`- Time: ${ago}s ago`);
      }

      // Config
      lines.push("");
      lines.push("### Config");
      lines.push(`- Auto-route: ${config.autoRoute ? "ON" : "OFF"}`);
      lines.push(`- Preload: ${config.preloadOnStart ? "ON" : "OFF"}`);
      lines.push(`- Keep-alive: ${config.keepAliveMinutes}m`);
      lines.push(
        `- GPU threshold: ${(config.gpuMemoryThreshold * 100).toFixed(0)}%`
      );
      lines.push(`- Health check: every ${config.healthCheckIntervalSec}s`);

      return { text: lines.join("\n") };
    },
  };
}

function formatModelLine(
  label: string,
  name: string,
  status: { pulled: boolean; loaded: boolean; vramBytes: number; parameterSize?: string }
): string {
  const pullStatus = status.pulled ? "pulled" : "NOT PULLED";
  const loadStatus = status.loaded ? "LOADED" : "unloaded";
  const vram =
    status.vramBytes > 0
      ? ` (${(status.vramBytes / 1024 / 1024).toFixed(0)}MB VRAM)`
      : "";
  const params = status.parameterSize ? ` [${status.parameterSize}]` : "";
  return `- **${label}:** ${name} - ${pullStatus}, ${loadStatus}${vram}${params}`;
}

function formatBar(ratio: number, width: number = 10): string {
  const filled = Math.min(Math.round(ratio * width), width);
  const empty = width - filled;
  return "[" + "=".repeat(filled) + "-".repeat(empty) + "]";
}

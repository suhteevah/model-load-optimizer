/**
 * Gateway RPC methods for model-load-optimizer.
 * Exposes model status and routing decisions over the OpenClaw gateway.
 */

import type { PluginConfig } from "../config.js";
import type { ModelRouter } from "../router.js";
import type { OllamaClient } from "../ollama-client.js";

type MethodOpts = {
  params?: Record<string, unknown>;
  reply: (data: unknown) => void;
};

export function createStatusMethod(
  router: ModelRouter,
  client: OllamaClient,
  config: PluginConfig
) {
  return async (opts: MethodOpts): Promise<void> => {
    const state = router.getState();
    const health = client.health;
    opts.reply({
      ollamaReachable: state.ollamaReachable,
      ollamaVersion: health.version,
      ollamaHost: config.ollamaHost,
      primaryModel: {
        ...state.primaryStatus,
        configName: config.primaryModel,
      },
      sidecarModel: {
        ...state.sidecarStatus,
        configName: config.sidecarModel,
      },
      fallbackModel: config.fallbackModel,
      gpu: {
        utilization: state.gpuUtilization,
        vramUsedMB: state.vramUsage?.usedMB,
        vramTotalMB: state.vramUsage?.totalMB,
      },
      routing: {
        autoRoute: config.autoRoute,
        totalDecisions: state.decisionsCount,
        primarySelections: state.primarySelections,
        sidecarSelections: state.sidecarSelections,
        fallbackSelections: state.fallbackSelections,
        lastDecision: state.lastDecision,
      },
      lastHealthCheck: state.lastHealthCheck,
    });
  };
}

export function createRouteMethod(router: ModelRouter) {
  return async (opts: MethodOpts): Promise<void> => {
    const params = opts.params ?? {};
    const decision = await router.selectModel({
      messageLength: typeof params.messageLength === "number" ? params.messageLength : undefined,
      conversationDepth: typeof params.conversationDepth === "number" ? params.conversationDepth : undefined,
      forceModel: typeof params.forceModel === "string" ? params.forceModel : undefined,
    });
    opts.reply(decision);
  };
}

export function createRefreshMethod(router: ModelRouter) {
  return async (opts: MethodOpts): Promise<void> => {
    await router.refreshHealth();
    const state = router.getState();
    opts.reply({
      success: true,
      ollamaReachable: state.ollamaReachable,
      primaryPulled: state.primaryStatus.pulled,
      sidecarPulled: state.sidecarStatus.pulled,
      lastHealthCheck: state.lastHealthCheck,
    });
  };
}

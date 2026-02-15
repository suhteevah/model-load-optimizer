/**
 * HTTP API routes for the dashboard.
 */

import type { PluginConfig } from "../config.js";
import type { ModelRouter } from "../router.js";
import type { OllamaClient } from "../ollama-client.js";

type HttpRequest = {
  method?: string;
  url?: string;
  query?: Record<string, string>;
};

type HttpResponse = {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
};

export function createStatusApiHandler(
  router: ModelRouter,
  client: OllamaClient,
  config: PluginConfig
) {
  return async (_req: HttpRequest, res: HttpResponse): Promise<void> => {
    const state = router.getState();
    const health = client.health;

    const data = {
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
        vramUsedMB: state.vramUsage?.usedMB ?? null,
        vramTotalMB: state.vramUsage?.totalMB ?? null,
      },
      routing: {
        autoRoute: config.autoRoute,
        totalDecisions: state.decisionsCount,
        primarySelections: state.primarySelections,
        sidecarSelections: state.sidecarSelections,
        fallbackSelections: state.fallbackSelections,
        lastDecision: state.lastDecision ?? null,
      },
      lastHealthCheck: state.lastHealthCheck,
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
}

export function createRefreshApiHandler(router: ModelRouter) {
  return async (_req: HttpRequest, res: HttpResponse): Promise<void> => {
    await router.refreshHealth();
    const state = router.getState();

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        ollamaReachable: state.ollamaReachable,
        lastHealthCheck: state.lastHealthCheck,
      })
    );
  };
}

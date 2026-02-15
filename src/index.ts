/**
 * Model Load Optimizer - OpenClaw Plugin
 *
 * Intelligent Ollama model routing:
 * - Picks primary (GPU+RAM hybrid) or sidecar (CPU-only) based on load
 * - Monitors GPU VRAM via nvidia-smi
 * - Pre-warms models on startup to eliminate cold-start latency
 * - Auto-routes requests to the best available model
 * - Falls back to remote API when Ollama is unavailable
 * - Dashboard at /plugins/model-load-optimizer/dashboard
 */

import { resolvePluginConfig } from "./config.js";
import { OllamaClient } from "./ollama-client.js";
import { ModelRouter } from "./router.js";
import { detectGpus, getSystemMemory } from "./gpu-detect.js";
import { createBeforeAgentStartHook } from "./hooks/before-agent-start.js";
import { createAgentEndHook } from "./hooks/agent-end.js";
import { createModelStatusCommand } from "./commands/model-status-command.js";
import {
  createStatusMethod,
  createRouteMethod,
  createRefreshMethod,
} from "./gateway/optimizer-methods.js";
import { createDashboardHandler } from "./web/dashboard.js";
import {
  createStatusApiHandler,
  createRefreshApiHandler,
} from "./web/api-routes.js";

// Plugin types - structural typing for OpenClaw plugin API
type PluginApi = {
  id: string;
  name: string;
  config: unknown;
  pluginConfig?: Record<string, unknown>;
  runtime: {
    state: {
      resolveStateDir: (config: unknown) => string;
    };
  };
  logger: {
    debug?: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  on: (
    hookName: string,
    handler: (...args: unknown[]) => unknown,
    opts?: { priority?: number }
  ) => void;
  registerService: (service: {
    id: string;
    start: (ctx: {
      config: unknown;
      stateDir: string;
      logger: unknown;
    }) => void | Promise<void>;
    stop?: (ctx: {
      config: unknown;
      stateDir: string;
      logger: unknown;
    }) => void | Promise<void>;
  }) => void;
  registerCommand: (command: unknown) => void;
  registerGatewayMethod: (
    method: string,
    handler: (opts: unknown) => void | Promise<void>
  ) => void;
  registerHttpRoute: (params: {
    path: string;
    handler: (req: unknown, res: unknown) => void | Promise<void>;
  }) => void;
};

const plugin = {
  id: "model-load-optimizer",
  name: "Model Load Optimizer",
  description:
    "Intelligent Ollama model routing based on GPU/RAM load and model availability",
  version: "1.0.0",

  register(api: PluginApi) {
    const config = resolvePluginConfig(api.pluginConfig);
    const logger = api.logger;

    // Detect hardware on startup
    const gpus = detectGpus();
    const memory = getSystemMemory();

    logger.info(
      `[model-load-optimizer] Hardware: ${gpus.length} GPU(s), ${memory.totalMB}MB RAM (${memory.freeMB}MB free)`
    );
    for (const gpu of gpus) {
      logger.info(
        `[model-load-optimizer] GPU: ${gpu.vendor} ${gpu.name} - ${gpu.vramMB}MB VRAM`
      );
    }

    // Initialize Ollama client and router
    const client = new OllamaClient(config.ollamaHost);
    const router = new ModelRouter(client, config);

    logger.info(
      `[model-load-optimizer] Primary: ${config.primaryModel}, Sidecar: ${config.sidecarModel}`
    );
    logger.info(
      `[model-load-optimizer] Auto-route: ${config.autoRoute}, Preload: ${config.preloadOnStart}, Keep-alive: ${config.keepAliveMinutes}m`
    );

    // ── Lifecycle Hooks ─────────────────────────────────────────────

    // before_agent_start: select optimal model
    api.on(
      "before_agent_start",
      createBeforeAgentStartHook(router, config, logger) as (
        ...args: unknown[]
      ) => unknown,
      { priority: 50 } // Run before usage-limiter (priority 100)
    );

    // agent_end: refresh keep-alive
    api.on(
      "agent_end",
      createAgentEndHook(client, config, logger) as (
        ...args: unknown[]
      ) => unknown
    );

    // ── Background Service ──────────────────────────────────────────

    api.registerService({
      id: "model-load-optimizer-service",
      start: async () => {
        logger.info("[model-load-optimizer] Starting health monitor...");
        await router.start();

        const state = router.getState();
        if (state.ollamaReachable) {
          logger.info(
            `[model-load-optimizer] Ollama online. Primary: ${state.primaryStatus.pulled ? "pulled" : "NOT PULLED"}, Sidecar: ${state.sidecarStatus.pulled ? "pulled" : "NOT PULLED"}`
          );

          // Log loaded models
          const health = client.health;
          if (health.runningModels.length > 0) {
            const models = health.runningModels
              .map((m) => m.name)
              .join(", ");
            logger.info(
              `[model-load-optimizer] Currently loaded: ${models}`
            );
          }
        } else {
          logger.warn(
            `[model-load-optimizer] Ollama at ${config.ollamaHost} is not reachable. Will retry in ${config.healthCheckIntervalSec}s.`
          );
        }
      },
      stop: () => {
        router.stop();
        logger.info("[model-load-optimizer] Health monitor stopped.");
      },
    });

    // ── Chat Command ────────────────────────────────────────────────

    api.registerCommand(
      createModelStatusCommand(router, client, config) as unknown
    );

    // ── Gateway RPC Methods ─────────────────────────────────────────

    api.registerGatewayMethod(
      "model-load-optimizer.status",
      createStatusMethod(router, client, config) as (
        opts: unknown
      ) => void
    );
    api.registerGatewayMethod(
      "model-load-optimizer.route",
      createRouteMethod(router) as (opts: unknown) => void
    );
    api.registerGatewayMethod(
      "model-load-optimizer.refresh",
      createRefreshMethod(router) as (opts: unknown) => void
    );

    // ── Web Dashboard ───────────────────────────────────────────────

    if (config.dashboardEnabled) {
      api.registerHttpRoute({
        path: "/plugins/model-load-optimizer/dashboard",
        handler: createDashboardHandler() as (
          req: unknown,
          res: unknown
        ) => void,
      });
      api.registerHttpRoute({
        path: "/plugins/model-load-optimizer/api/status",
        handler: createStatusApiHandler(
          router,
          client,
          config
        ) as (req: unknown, res: unknown) => Promise<void>,
      });
      api.registerHttpRoute({
        path: "/plugins/model-load-optimizer/api/refresh",
        handler: createRefreshApiHandler(router) as (
          req: unknown,
          res: unknown
        ) => Promise<void>,
      });

      logger.info(
        "[model-load-optimizer] Dashboard at /plugins/model-load-optimizer/dashboard"
      );
    }
  },
};

export default plugin;

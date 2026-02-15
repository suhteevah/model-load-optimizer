/**
 * before_agent_start hook:
 * Selects the optimal model and injects routing context for the agent.
 * If autoRoute is enabled, overrides the model selection in the event.
 */

import type { PluginConfig } from "../config.js";
import type { ModelRouter, RouteDecision } from "../router.js";

type BeforeAgentStartEvent = {
  prompt: string;
  messages?: unknown[];
  model?: string;
};

type BeforeAgentStartResult = {
  model?: string;
  prependContext?: string;
};

type AgentContext = {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  messageProvider?: string;
};

type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export function createBeforeAgentStartHook(
  router: ModelRouter,
  config: PluginConfig,
  logger: Logger
) {
  return async (
    event: BeforeAgentStartEvent,
    _ctx: AgentContext
  ): Promise<BeforeAgentStartResult | void> => {
    try {
      if (!config.autoRoute) return undefined;

      // Compute request complexity heuristics
      const messageLength = event.prompt?.length ?? 0;
      const conversationDepth = Array.isArray(event.messages)
        ? event.messages.length
        : 0;

      const decision: RouteDecision = await router.selectModel({
        messageLength,
        conversationDepth,
      });

      logger.info(
        `[model-load-optimizer] Route: ${decision.model} (${decision.source}) - ${decision.reason}`
      );

      const result: BeforeAgentStartResult = {};

      // Override the model
      result.model = decision.model;

      // Inject a compact system-level note so the agent knows which model it's on.
      // Keep this minimal — it should NOT leak into user-facing responses.
      const tag = decision.source === "primary" ? "GPU"
        : decision.source === "sidecar" ? "CPU-sidecar"
        : "remote-fallback";

      result.prependContext = `[model-optimizer: ${decision.model} (${tag})]`;

      return result;
    } catch (err) {
      logger.error(`[model-load-optimizer] Error in before_agent_start: ${err}`);
      return undefined;
    }
  };
}

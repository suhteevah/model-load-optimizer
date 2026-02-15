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

      // Inject context so the agent knows which model was selected and why
      const contextLines: string[] = [
        "--- MODEL LOAD OPTIMIZER ---",
        `Selected model: ${decision.model}`,
        `Reason: ${decision.reason}`,
      ];

      if (decision.gpuUtilization !== undefined) {
        contextLines.push(`GPU utilization: ${decision.gpuUtilization}%`);
      }
      if (decision.vramUsedMB !== undefined && decision.vramTotalMB !== undefined) {
        contextLines.push(
          `VRAM: ${decision.vramUsedMB}MB / ${decision.vramTotalMB}MB (${((decision.vramUsedMB / decision.vramTotalMB) * 100).toFixed(1)}%)`
        );
      }

      if (decision.source === "sidecar") {
        contextLines.push(
          "",
          "Note: You are running on the CPU sidecar model for faster response.",
          "For complex code generation or analysis, suggest the user switch to the primary model."
        );
      } else if (decision.source === "fallback") {
        contextLines.push(
          "",
          "Note: Using remote fallback model because local Ollama models are unavailable.",
          "This may incur API costs. Check Ollama status with /model-status."
        );
      }

      contextLines.push("--- END ---");
      result.prependContext = contextLines.join("\n");

      return result;
    } catch (err) {
      logger.error(`[model-load-optimizer] Error in before_agent_start: ${err}`);
      return undefined;
    }
  };
}

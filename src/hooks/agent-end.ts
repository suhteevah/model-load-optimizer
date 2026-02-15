/**
 * agent_end hook:
 * After each agent completes, refresh the keep-alive on whichever model was used.
 * This prevents the model from being unloaded during active sessions.
 */

import type { PluginConfig } from "../config.js";
import type { OllamaClient } from "../ollama-client.js";

type AgentEndEvent = {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
  model?: string;
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

export function createAgentEndHook(
  client: OllamaClient,
  config: PluginConfig,
  logger: Logger
) {
  return async (_event: AgentEndEvent, _ctx: AgentContext): Promise<void> => {
    try {
      // Refresh keep-alive on the model that was used
      const modelUsed = _event.model;
      if (!modelUsed) return;

      // Only refresh keep-alive for local ollama models
      const ollamaModel = modelUsed.replace(/^ollama\//, "");
      if (
        ollamaModel === config.primaryModel ||
        ollamaModel === config.sidecarModel
      ) {
        // Fire and forget - don't block agent end
        client
          .warmModel(ollamaModel, config.keepAliveMinutes)
          .then((ok) => {
            if (ok) {
              logger.info(
                `[model-load-optimizer] Refreshed keep-alive: ${ollamaModel} (${config.keepAliveMinutes}m)`
              );
            }
          })
          .catch(() => {
            // Silently ignore - model might have been unloaded
          });
      }
    } catch (err) {
      logger.error(`[model-load-optimizer] Error in agent_end: ${err}`);
    }
  };
}

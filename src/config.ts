/**
 * Plugin configuration type and resolver.
 */

export type PluginConfig = {
  ollamaHost: string;
  primaryModel: string;
  sidecarModel: string;
  fallbackModel?: string;
  keepAliveMinutes: number;
  gpuMemoryThreshold: number;
  healthCheckIntervalSec: number;
  preloadOnStart: boolean;
  autoRoute: boolean;
  dashboardEnabled: boolean;
};

const DEFAULTS: PluginConfig = {
  ollamaHost: "http://localhost:11434",
  primaryModel: "deepseek-coder-v2:16b",
  sidecarModel: "qwen2.5-coder:7b",
  keepAliveMinutes: 30,
  gpuMemoryThreshold: 0.85,
  healthCheckIntervalSec: 30,
  preloadOnStart: true,
  autoRoute: true,
  dashboardEnabled: true,
};

export function resolvePluginConfig(
  raw: Record<string, unknown> | undefined
): PluginConfig {
  if (!raw) return { ...DEFAULTS };

  return {
    ollamaHost:
      typeof raw.ollamaHost === "string" ? raw.ollamaHost : DEFAULTS.ollamaHost,
    primaryModel:
      typeof raw.primaryModel === "string" ? raw.primaryModel : DEFAULTS.primaryModel,
    sidecarModel:
      typeof raw.sidecarModel === "string" ? raw.sidecarModel : DEFAULTS.sidecarModel,
    fallbackModel:
      typeof raw.fallbackModel === "string" ? raw.fallbackModel : undefined,
    keepAliveMinutes:
      typeof raw.keepAliveMinutes === "number" ? raw.keepAliveMinutes : DEFAULTS.keepAliveMinutes,
    gpuMemoryThreshold:
      typeof raw.gpuMemoryThreshold === "number" ? raw.gpuMemoryThreshold : DEFAULTS.gpuMemoryThreshold,
    healthCheckIntervalSec:
      typeof raw.healthCheckIntervalSec === "number"
        ? raw.healthCheckIntervalSec
        : DEFAULTS.healthCheckIntervalSec,
    preloadOnStart:
      typeof raw.preloadOnStart === "boolean" ? raw.preloadOnStart : DEFAULTS.preloadOnStart,
    autoRoute:
      typeof raw.autoRoute === "boolean" ? raw.autoRoute : DEFAULTS.autoRoute,
    dashboardEnabled:
      typeof raw.dashboardEnabled === "boolean" ? raw.dashboardEnabled : DEFAULTS.dashboardEnabled,
  };
}

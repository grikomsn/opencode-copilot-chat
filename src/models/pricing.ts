import type { ModelCost } from "../kit/pricing";

export type { ModelCost } from "../kit/pricing";

const OFFICIAL_MODEL_COSTS: Readonly<Record<string, ModelCost>> = {
  "kimi-k2.6": { input: 0.95, cacheRead: 0.16, output: 4 },
  "deepseek-v4-flash": { input: 0.15, cacheRead: 0.003, output: 0.6 },
  "minimax-m3": { input: 0.3, cacheRead: 0.06, output: 1.2 },
  "qwen3.7-plus": { input: 0.4, cacheRead: 0.04, output: 1.6 },
};

export function openCodeModelCost(id: string, discovered?: ModelCost): ModelCost | undefined {
  if (discovered) return discovered;
  if (id.endsWith("-free") || id === "big-pickle") return { input: 0, cacheRead: 0, output: 0 };
  return OFFICIAL_MODEL_COSTS[id];
}


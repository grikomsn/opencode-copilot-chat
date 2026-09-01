export interface ModelCost {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
}

export interface ModelPricingFields {
  readonly pricing: string;
  readonly inputCost: number;
  readonly outputCost: number;
  readonly cacheCost?: number;
  readonly priceCategory: "low" | "medium" | "high" | "very_high";
}

const OFFICIAL_MODEL_COSTS: Readonly<Record<string, ModelCost>> = {
  "kimi-k2.6": { input: 0.95, cacheRead: 0.16, output: 4 },
  "deepseek-v4-flash": { input: 0.22, cacheRead: 0.007, output: 0.66 },
  "minimax-m3": { input: 0.3, cacheRead: 0.06, output: 1.2 },
  "qwen3.7-plus": { input: 0.4, cacheRead: 0.04, output: 1.6 },
};

export function openCodeModelCost(id: string, discovered?: ModelCost): ModelCost | undefined {
  if (discovered) return discovered;
  if (id.endsWith("-free") || id === "big-pickle") return { input: 0, cacheRead: 0, output: 0 };
  return OFFICIAL_MODEL_COSTS[id];
}

export function modelPricingFields(cost: ModelCost | undefined): ModelPricingFields | undefined {
  if (!cost) return undefined;
  if (cost.input === 0 && cost.output === 0) {
    return {
      pricing: "Free",
      inputCost: 0,
      outputCost: 0,
      ...(cost.cacheRead === undefined ? {} : { cacheCost: 0 }),
      priceCategory: "low",
    };
  }
  return {
    pricing: `In: $${formatPrice(cost.input)} · Out: $${formatPrice(cost.output)} /1M tokens`,
    inputCost: Math.round(cost.input * 100),
    outputCost: Math.round(cost.output * 100),
    ...(cost.cacheRead === undefined ? {} : { cacheCost: Math.round(cost.cacheRead * 100) }),
    priceCategory: costCategory(cost),
  };
}

export function costCategory(cost: Pick<ModelCost, "input" | "output">): ModelPricingFields["priceCategory"] {
  const weighted = cost.input * 3 + cost.output;
  if (weighted <= 2) return "low";
  if (weighted <= 25) return "medium";
  if (weighted <= 50) return "high";
  return "very_high";
}

function formatPrice(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

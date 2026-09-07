import type * as vscode from "vscode";
import type { EndpointKind } from "../transport/protocol";
import type { OpenCodeModel } from "./catalog";
import { advertisedModelLimits } from "./limits";

export type ReasoningEffort = "off" | "on" | "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ThinkingSelection {
  effort: ReasoningEffort;
  budget?: number;
}

export type ModelConfiguration = Readonly<Record<string, unknown>>;

interface ThinkingSpec {
  efforts: readonly ReasoningEffort[];
  defaultEffort: ReasoningEffort;
  budgets?: readonly ("auto" | number)[];
}

export type ThinkingFamily = "deepseek" | "glm" | "kimi" | "minimax" | "mimo" | "openai" | "qwen";

const EFFORT_VALUES = new Set<ReasoningEffort>(["off", "on", "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const EFFORT_DESCRIPTIONS: Record<ReasoningEffort, string> = {
  off: "Fastest responses without optional thinking",
  on: "Enable thinking with the provider default",
  auto: "Let the model choose how much to think",
  none: "Disable additional reasoning",
  minimal: "Minimal reasoning for faster responses",
  low: "Faster responses with lighter reasoning",
  medium: "Balanced speed and reasoning depth",
  high: "Greater reasoning depth for complex tasks",
  xhigh: "Extra-high reasoning effort",
  max: "Maximum reasoning effort",
};

export function resolveThinkingSelection(
  model: OpenCodeModel,
  configuration: ModelConfiguration | undefined,
  workspaceDefault: unknown,
  workspaceBudget?: unknown,
): ThinkingSelection | undefined {
  const spec = thinkingSpec(model);
  if (!spec) return undefined;
  const requested = [configuration?.reasoningEffort, configuration?.thinkingMode, workspaceDefault]
    .map(reasoningValue)
    .find((value): value is ReasoningEffort => Boolean(value && spec.efforts.includes(value)));
  const effort = requested ?? spec.defaultEffort;
  const budgetValue = configuration?.thinkingBudget ?? workspaceBudget;
  const budget = typeof budgetValue === "string" || typeof budgetValue === "number" ? Number(budgetValue) : NaN;
  return { effort, ...(spec.budgets?.includes(budget) ? { budget } : {}) };
}

export function requestModelConfiguration(options: {
  readonly modelConfiguration?: ModelConfiguration;
  readonly configuration?: ModelConfiguration;
}): ModelConfiguration | undefined {
  return options.modelConfiguration ?? options.configuration;
}

/** A selectable context window tier shown on a model's picker configuration. */
export interface ContextSizeOption {
  /** Context cap in input tokens; "auto" selects the model's default handling. */
  readonly value: number | "auto";
  /** Short picker label, e.g. "Auto", "128K", or "Maximum". */
  readonly label: string;
  /** Picker description for the tier. */
  readonly description: string;
}

/** Fixed context tiers offered below a model's advertised input limit. */
const CONTEXT_SIZE_TIERS: readonly { value: number; label: string }[] = [
  { value: 65_536, label: "64K" },
  { value: 131_072, label: "128K" },
  { value: 200_000, label: "200K" },
];

/** Builds the context window tiers offered for a model's input limit; undefined when no tier fits. */
export function contextSizeOptions(maxInputTokens: number): ContextSizeOption[] | undefined {
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= CONTEXT_SIZE_TIERS[0].value) return undefined;
  const tiers = CONTEXT_SIZE_TIERS.filter((tier) => tier.value < maxInputTokens);
  if (!tiers.length) return undefined;
  return [
    // VS Code treats every numeric contextSize, including zero, as an input budget.
    { value: "auto", label: "Auto", description: "Default context handling for this model." },
    ...tiers.map((tier) => ({
      value: tier.value,
      label: tier.label,
      description: `Keep the conversation under ${tier.label} input tokens.`,
    })),
    {
      value: maxInputTokens,
      label: "Maximum",
      description: "Use the model's full available input limit.",
    },
  ];
}

/** Resolves the effective context cap for a request; Auto and Maximum return undefined. */
export function resolveContextCap(contextSize: number, maxInputTokens: number): number | undefined {
  if (!Number.isFinite(contextSize) || contextSize <= 0) return undefined;
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= 0) return undefined;
  const cap = Math.min(Math.floor(contextSize), maxInputTokens);
  return cap < maxInputTokens ? cap : undefined;
}

/** Reads the opted-in context size from picker configuration; 0 keeps the model's default handling. */
export function resolveContextSize(configuration: ModelConfiguration | undefined): number {
  const value = configuration?.contextSize;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function modelConfigurationSchema(
  model: OpenCodeModel,
  configuredEffort?: unknown,
  configuredBudget?: unknown,
): vscode.LanguageModelConfigurationSchema | undefined {
  const spec = thinkingSpec(model);
  const contextOptions = contextSizeOptions(advertisedModelLimits(model).maxInputTokens);
  if (!spec && !contextOptions) return undefined;
  const alwaysOnKimi = /^kimi-k2\.7/i.test(bareModelId(model.rawModelId));
  const requestedDefault = reasoningValue(configuredEffort);
  const defaultEffort = requestedDefault && spec?.efforts.includes(requestedDefault) ? requestedDefault : spec?.defaultEffort;
  const requestedBudget = typeof configuredBudget === "string" || typeof configuredBudget === "number" ? Number(configuredBudget) : NaN;
  const defaultBudget = spec?.budgets?.includes(requestedBudget) ? requestedBudget : spec?.budgets?.[0];
  return {
    type: "object",
    properties: {
      ...(spec ? {
        reasoningEffort: {
          type: "string",
          title: spec.efforts.every((effort) => effort === "off" || effort === "on" || effort === "auto") ? "Thinking" : "Thinking Effort",
          enum: [...spec.efforts],
          default: defaultEffort,
          enumItemLabels: spec.efforts.map((effort) => alwaysOnKimi ? "Always On (K2.7)" : effortLabel(effort)),
          enumDescriptions: spec.efforts.map((effort) => alwaysOnKimi
            ? "Kimi K2.7-code requires thinking enabled (Moonshot API constraint)"
            : EFFORT_DESCRIPTIONS[effort]),
          description: "Choose this model's thinking mode or reasoning effort.",
          group: "navigation",
        },
        ...(spec.budgets ? {
          thinkingBudget: {
            type: "string",
            title: "Thinking Budget",
            enum: spec.budgets.map(String),
            default: String(defaultBudget),
            enumItemLabels: spec.budgets.map(formatBudget),
            enumDescriptions: spec.budgets.map((budget) => budget === "auto"
              ? "Use the provider default thinking budget"
              : `Allow up to ${budget.toLocaleString("en-US")} thinking tokens`),
            description: "Maximum token budget used when thinking is enabled.",
            ...(contextOptions ? {} : { group: "tokens" }),
          },
        } : {}),
      } : {}),
      ...(contextOptions ? {
        contextSize: {
          type: ["string", "number"],
          title: "Context Window",
          enum: contextOptions.map((option) => option.value),
          enumItemLabels: contextOptions.map((option) => option.label),
          enumDescriptions: contextOptions.map((option) => option.description),
          default: "auto",
          group: "tokens",
        },
      } : {}),
    },
  };
}

export function thinkingPayload(model: OpenCodeModel, selection: ThinkingSelection | undefined): Record<string, unknown> {
  if (!selection) return {};
  const family = thinkingFamily(model.rawModelId, model.family);
  const modelId = bareModelId(model.rawModelId);
  const off = selection.effort === "off" || selection.effort === "none";

  if (family === "qwen") {
    if (model.endpoint === "messages") {
      if (selection.effort === "auto") return {};
      return { thinking: off ? { type: "disabled" } : { type: "enabled", ...(selection.budget ? { budget_tokens: selection.budget } : {}) } };
    }
    if (selection.effort === "auto") return selection.budget ? { thinking_budget: selection.budget } : {};
    return { enable_thinking: !off, ...(!off && selection.budget ? { thinking_budget: selection.budget } : {}) };
  }

  if (family === "kimi") {
    if (/^kimi-k2\.7/i.test(modelId)) return { thinking: { type: "enabled", keep: "all" } };
    return { thinking: { type: off ? "disabled" : "enabled" } };
  }

  if (family === "minimax") {
    if (off) return {};
    return { thinking: { type: /^minimax-m2\./i.test(modelId) ? "enabled" : "adaptive" } };
  }

  if (family === "glm") {
    if (off) return { thinking: { type: "disabled" } };
    if (selection.effort === "on") return { thinking: { type: "enabled" } };
    return { reasoning_effort: selection.effort };
  }

  if (family === "mimo") {
    if (off) return {};
    const budget = ({ low: 8192, medium: 16384, high: 32768 } as Partial<Record<ReasoningEffort, number>>)[selection.effort];
    return { reasoning_effort: selection.effort, ...(budget ? { budget_tokens: budget } : {}) };
  }

  if (!family) return {};
  if (off) return {};
  return effortPayload(model.endpoint, selection.effort);
}

export function thinkingFamilyForModel(model: OpenCodeModel): ThinkingFamily | undefined {
  return thinkingFamily(model.rawModelId, model.family);
}

function thinkingSpec(model: OpenCodeModel): ThinkingSpec | undefined {
  const family = thinkingFamily(model.rawModelId, model.family);
  const options = model.reasoningOptions ?? [];
  if (!model.reasoning && !family && !options.length) return undefined;
  const effortValues = options
    .filter((option) => option.type === "effort" && Array.isArray(option.values))
    .flatMap((option) => option.values ?? [])
    .flatMap((value) => {
      const effort = reasoningValue(value);
      return effort && effort !== "none" && effort !== "off" ? [effort] : [];
    })
    .filter((value, index, values) => values.indexOf(value) === index);
  const hasToggle = options.some((option) => option.type === "toggle");
  const budgetMax = Math.max(0, ...options.filter((option) => option.type === "budget_tokens").map((option) => option.max ?? 0));

  if (family === "qwen") {
    const budgets: ("auto" | number)[] = ["auto", ...[4096, 16384, 32768, 81920].filter((value) => !budgetMax || value <= budgetMax)];
    return { efforts: ["off", "auto", "on"], defaultEffort: "auto", ...(budgets.length ? { budgets } : {}) };
  }
  if (/^kimi-k2\.7/i.test(bareModelId(model.rawModelId))) return { efforts: ["on"], defaultEffort: "on" };
  if (effortValues.length) {
    const efforts = ["off" as const, ...(hasToggle ? ["on" as const] : []), ...effortValues];
    return { efforts, defaultEffort: synchronizedDefault(efforts) };
  }
  if (family === "openai") return { efforts: ["off", "low", "medium", "high", "xhigh"], defaultEffort: "high" };
  if (family === "deepseek") return { efforts: ["off", "low", "medium", "high", "max"], defaultEffort: "high" };
  if (family === "glm") return hasToggle
    ? { efforts: ["off", "on"], defaultEffort: "on" }
    : { efforts: ["off", "high", "max"], defaultEffort: "high" };
  if (family === "mimo") return { efforts: ["off", "low", "medium", "high"], defaultEffort: "high" };
  if (family === "kimi" || family === "minimax" || hasToggle) return { efforts: ["off", "on"], defaultEffort: "on" };
  if (model.reasoning) return { efforts: ["off", "on"], defaultEffort: "on" };
  return undefined;
}

function synchronizedDefault(efforts: readonly ReasoningEffort[]): ReasoningEffort {
  if (efforts.includes("high")) return "high";
  if (efforts.includes("on")) return "on";
  if (efforts.includes("auto")) return "auto";
  return [...efforts].reverse().find((effort) => effort !== "off" && effort !== "none") ?? efforts[0] ?? "off";
}

function thinkingFamily(modelId: string, catalogFamily?: string): ThinkingFamily | undefined {
  const id = bareModelId(modelId);
  const family = catalogFamily?.toLowerCase() ?? "";
  if (id.startsWith("gpt-")) return "openai";
  if (id.startsWith("deepseek-")) return "deepseek";
  if (id.startsWith("glm-")) return "glm";
  if (id.startsWith("kimi-")) return "kimi";
  if (id.startsWith("minimax-")) return "minimax";
  if (id.startsWith("mimo-")) return "mimo";
  if (/^qwen3(?:\.|-)/.test(id)) return "qwen";
  if (family === "gpt" || family.startsWith("gpt-") || family === "openai") return "openai";
  if (family.startsWith("deepseek")) return "deepseek";
  if (family.startsWith("glm")) return "glm";
  if (family.startsWith("kimi")) return "kimi";
  if (family.startsWith("minimax")) return "minimax";
  if (family.startsWith("mimo")) return "mimo";
  if (family.startsWith("qwen")) return "qwen";
  return undefined;
}

function bareModelId(modelId: string): string {
  return modelId.toLowerCase().split("/").at(-1) ?? modelId.toLowerCase();
}

function effortPayload(endpoint: EndpointKind, effort: ReasoningEffort): Record<string, unknown> {
  if (endpoint === "responses") return { reasoning: { effort } };
  if (endpoint === "messages") return { output_config: { effort } };
  if (endpoint === "google") return { thinkingConfig: { thinkingLevel: effort } };
  return { reasoning_effort: effort };
}

function reasoningValue(value: unknown): ReasoningEffort | undefined {
  return typeof value === "string" && EFFORT_VALUES.has(value as ReasoningEffort) ? value as ReasoningEffort : undefined;
}

function effortLabel(value: ReasoningEffort): string {
  if (value === "off" || value === "none") return "Off";
  if (value === "xhigh") return "Extra High";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatBudget(value: "auto" | number): string {
  if (value === "auto") return "Auto";
  return value >= 1024 ? `${String(Math.round(value / 1024))}K` : String(value);
}

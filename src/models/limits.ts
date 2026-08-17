import type { OpenCodeModel } from "./catalog";

const UI_OUTPUT_TOKEN_RESERVE = 8_192;
const MIN_TOKEN_SAFETY_MARGIN = 64;
const TOKEN_SAFETY_RATIO = 0.12;

export interface AdvertisedModelLimits {
  maxInputTokens: number;
  maxOutputTokens: number;
}

export function advertisedModelLimits(model: OpenCodeModel): AdvertisedModelLimits {
  const output = Math.max(1, Math.min(model.maxOutputTokens, UI_OUTPUT_TOKEN_RESERVE, model.contextLength - 1));
  const input = Math.max(1, Math.min(model.maxInputTokens ?? model.contextLength, model.contextLength - output));
  return { maxInputTokens: input, maxOutputTokens: output };
}

export function requestOutputLimit(model: OpenCodeModel, configuredLimit: number, estimatedInputTokens: number): number {
  const estimate = Math.max(0, Math.floor(estimatedInputTokens));
  const safety = Math.max(MIN_TOKEN_SAFETY_MARGIN, Math.ceil(estimate * TOKEN_SAFETY_RATIO));
  const remaining = Math.max(1, model.contextLength - estimate - safety);
  const requested = configuredLimit > 0 ? Math.floor(configuredLimit) : model.maxOutputTokens;
  return Math.max(1, Math.min(model.maxOutputTokens, requested, remaining));
}

export interface OpenCodeUsageSnapshot {
  updatedAt?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  tracked?: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export function usageFromPayload(payload: Record<string, unknown>, model: string, updatedAt = Date.now()): OpenCodeUsageSnapshot {
  const inputTokens = number(payload.prompt_tokens) ?? number(payload.input_tokens) ?? number(payload.promptTokenCount);
  const outputTokens = number(payload.completion_tokens) ?? number(payload.output_tokens) ?? number(payload.candidatesTokenCount);
  const totalTokens = number(payload.total_tokens) ?? number(payload.totalTokenCount) ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
  return { updatedAt, model, ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }), ...(totalTokens === undefined ? {} : { totalTokens }) };
}

export function recordRequestUsage(
  current: OpenCodeUsageSnapshot,
  request: OpenCodeUsageSnapshot,
): OpenCodeUsageSnapshot {
  if (request.inputTokens === undefined && request.outputTokens === undefined && request.totalTokens === undefined) {
    return { ...current, ...request };
  }
  return {
    ...current,
    ...request,
    tracked: {
      requests: (current.tracked?.requests ?? 0) + 1,
      inputTokens: (current.tracked?.inputTokens ?? 0) + (request.inputTokens ?? 0),
      outputTokens: (current.tracked?.outputTokens ?? 0) + (request.outputTokens ?? 0),
      totalTokens: (current.tracked?.totalTokens ?? 0) + (request.totalTokens ?? 0),
    },
  };
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

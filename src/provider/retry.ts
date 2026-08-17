export interface RetryPatch {
  body: Record<string, unknown>;
  reason: string;
}

export function analyzeHttp400ForRetry(message: string, body: Record<string, unknown>): RetryPatch | undefined {
  const context = patchContextOverflow(message, body);
  if (context) return context;

  const fields = ["thinking", "enable_thinking", "reasoning_effort", "thinking_budget", "budget_tokens", "temperature"];
  for (const field of fields) {
    const rejected = new RegExp(`(?:invalid|unsupported|extra inputs[^\\n]*permitted)[^\\n]*${field}|${field}[^\\n]*(?:invalid|unsupported|only accepts)`, "i");
    if (!rejected.test(message) || !(field in body)) continue;
    const next = { ...body };
    delete next[field];
    return { body: next, reason: `removed rejected ${field}` };
  }

  const generic = /extra inputs are not permitted[^\n]*field:\s*['"]([^'"]+)['"]/i.exec(message);
  if (generic?.[1] && generic[1] in body) {
    const next = { ...body };
    delete next[generic[1]];
    return { body: next, reason: `removed rejected ${generic[1]}` };
  }
  return undefined;
}

export function isTransientServerError(status: number, detail: string): boolean {
  return status === 502 || status === 503 || status === 504 || status >= 500 && /Router[._-]?Unavailable/i.test(detail);
}

export function retryDelayMs(attempt: number): number {
  return Math.min(2_000, 250 * 2 ** Math.max(0, attempt));
}

function patchContextOverflow(message: string, body: Record<string, unknown>): RetryPatch | undefined {
  const context = tokenCount(/maximum context length is\s*([\d,]+)\s*tokens?/i.exec(message)?.[1]);
  const requested = tokenCount(/you requested\s*([\d,]+)\s*tokens?/i.exec(message)?.[1]);
  if (!context || !requested || requested <= context) return undefined;

  const key = ["max_tokens", "max_output_tokens"].find((candidate) => positive(body[candidate]) !== undefined);
  const generation = record(body.generationConfig);
  const current = key ? positive(body[key]) : positive(generation?.maxOutputTokens);
  if (!current) return undefined;
  const reportedOutput = tokenCount(/([\d,]+)\s+in the (?:completion|output)/i.exec(message)?.[1]) ?? current;
  const nextOutput = Math.floor(reportedOutput - (requested - context) - Math.max(256, Math.ceil(context * 0.001)));
  if (nextOutput < 1 || nextOutput >= current) return undefined;
  const patched = key
    ? { ...body, [key]: nextOutput }
    : { ...body, generationConfig: { ...generation, maxOutputTokens: nextOutput } };
  return { body: patched, reason: `reduced output limit from ${String(current)} to ${String(nextOutput)}` };
}

function tokenCount(value: string | undefined): number | undefined {
  return value ? positive(Number(value.replaceAll(",", ""))) : undefined;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

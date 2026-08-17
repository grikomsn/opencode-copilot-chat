export const DEFAULT_CONSOLE_SERVER = "https://opencode.ai/console";
export const ZEN_API_BASE_URL = "https://opencode.ai/zen/v1";
export const GO_API_BASE_URL = "https://opencode.ai/zen/go/v1";
export const OPENCODE_CLIENT_ID = "opencode-cli";
export const OPENCODE_CLIENT = "opencode-copilot-chat";

export type OpenCodeMode = "zen" | "go" | "console";
export type EndpointKind = "chat-completions" | "messages" | "responses" | "google";

export function apiBaseForMode(mode: OpenCodeMode): string {
  return mode === "go" ? GO_API_BASE_URL : ZEN_API_BASE_URL;
}

export function buildAuthHeaders(endpoint: EndpointKind, token: string): Record<string, string> {
  if (endpoint === "messages") {
    return { "x-api-key": token, "anthropic-version": "2023-06-01" };
  }
  if (endpoint === "google") return { "x-goog-api-key": token };
  return { Authorization: `Bearer ${token}` };
}

export function buildRequestHeaders(
  endpoint: EndpointKind,
  token: string,
  userAgent: string,
  requestId: string,
  sessionId: string,
  additionalHeaders: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    ...additionalHeaders,
    ...buildAuthHeaders(endpoint, token),
    Accept: "text/event-stream, application/json",
    "Content-Type": "application/json",
    "User-Agent": userAgent,
    "x-opencode-client": OPENCODE_CLIENT,
    "x-opencode-request": requestId,
    "x-opencode-session": sessionId,
  };
}

export function resolveEndpointKind(
  modelId: string,
  mode: OpenCodeMode,
  packageName?: string,
): EndpointKind {
  const npm = packageName?.toLowerCase() ?? "";
  if (npm.includes("anthropic")) return "messages";
  if (npm.includes("google")) return "google";
  if (npm === "@ai-sdk/openai" || npm.endsWith("/openai")) return "responses";
  if (/^gpt-/i.test(modelId)) return "responses";
  if (/^claude-/i.test(modelId)) return "messages";
  if (mode === "go" && (/^minimax-m2\./i.test(modelId) || /^qwen3\.(?:5|6)-plus/i.test(modelId) || /^qwen3\.7-max$/i.test(modelId))) {
    return "messages";
  }
  if (mode === "zen" && /^gemini-/i.test(modelId)) return "google";
  return "chat-completions";
}

export function endpointUrl(baseUrl: string, endpoint: EndpointKind, modelId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (endpoint === "messages") return `${base}/messages`;
  if (endpoint === "responses") return `${base}/responses`;
  if (endpoint === "google") return `${base}/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
  return `${base}/chat/completions`;
}

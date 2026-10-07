export const DEFAULT_CONSOLE_SERVER = "https://opencode.ai/console";
export const CONSOLE_API_BASE_URL = "https://opencode.ai/zen/v1";
export const GO_API_BASE_URL = "https://opencode.ai/zen/go/v1";
export const OPENCODE_CLIENT_ID = "opencode-cli";
export const OPENCODE_CLIENT = "opencode-copilot-chat";

/** Legacy zen value of `opencode.defaultMode` and the inline gateway setting. */
export const LEGACY_ZEN_MODE = "zen";

export type OpenCodeMode = "console" | "go";
export type EndpointKind = "chat-completions" | "messages" | "responses" | "google";

/** Modes that can appear in persisted settings or state written by older versions. */
export type LegacyOpenCodeMode = OpenCodeMode | "zen";

export function normalizeMode(value: unknown): OpenCodeMode {
  return value === "go" ? "go" : "console";
}

export function resolveConsoleVerificationUrl(server: string, verification: string): string {
  let url: URL;
  try {
    url = new URL(verification, `${server.replace(/\/+$/, "")}/`);
  } catch {
    throw new Error("OpenCode Console returned an invalid verification URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OpenCode Console returned a non-HTTP verification URL");
  }
  return url.href;
}

export function apiBaseForMode(mode: OpenCodeMode): string {
  return mode === "go" ? GO_API_BASE_URL : CONSOLE_API_BASE_URL;
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
  // Family-wide rather than version-pinned: every live grok* and qwen* model
  // on both gateways is responses or messages, and models.dev omits `npm` for
  // all qwen ids, which is the only signal the checks above have.
  if (/^grok(?:-|$)/i.test(modelId)) return "responses";
  if (/^muse-spark-/i.test(modelId)) return "responses";
  // qwen3.8-max is the only live qwen whose documented and live-verified shape
  // on the zen gateway is chat completions (the gateway rejects it on
  // /messages with a ModelProtocolUnsupported error); Go keeps messages.
  if (/^qwen-?3\.8-max$/i.test(modelId)) return mode === "go" ? "messages" : "chat-completions";
  if (/^qwen/i.test(modelId)) return "messages";
  if (mode === "go" && /^minimax-/i.test(modelId)) return "messages";
  if (mode === "console" && /^gemini-/i.test(modelId)) return "google";
  return "chat-completions";
}

export function endpointUrl(baseUrl: string, endpoint: EndpointKind, modelId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (endpoint === "messages") return `${base}/messages`;
  if (endpoint === "responses") return `${base}/responses`;
  if (endpoint === "google") return `${base}/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
  return `${base}/chat/completions`;
}

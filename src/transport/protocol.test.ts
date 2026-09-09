import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthHeaders, buildRequestHeaders, DEFAULT_CONSOLE_SERVER, endpointUrl, resolveConsoleVerificationUrl, resolveEndpointKind } from "./protocol";

test("resolves Console device verification URLs onto opencode.ai/console", () => {
  const complete = "/console/device?user_code=ABCD-EFGH&client_id=opencode-cli";
  const expected = "https://opencode.ai/console/device?user_code=ABCD-EFGH&client_id=opencode-cli";
  assert.equal(resolveConsoleVerificationUrl(DEFAULT_CONSOLE_SERVER, complete), expected);
  assert.equal(resolveConsoleVerificationUrl("https://opencode.ai/console/", complete), expected);
  assert.equal(resolveConsoleVerificationUrl("https://console.opencode.ai", complete), expected);
  assert.equal(resolveConsoleVerificationUrl("https://console.opencode.ai/", complete), expected);
  assert.equal(resolveConsoleVerificationUrl("https://console.opencode.ai", "/device?user_code=ABCD-EFGH"), "https://opencode.ai/console/device?user_code=ABCD-EFGH");
  assert.equal(resolveConsoleVerificationUrl(DEFAULT_CONSOLE_SERVER, "device?user_code=ABCD-EFGH"), "https://opencode.ai/console/device?user_code=ABCD-EFGH");
  assert.equal(resolveConsoleVerificationUrl(DEFAULT_CONSOLE_SERVER, expected), expected);
  assert.equal(
    resolveConsoleVerificationUrl(DEFAULT_CONSOLE_SERVER, "https://console.opencode.ai/console/device?user_code=ABCD-EFGH"),
    "https://opencode.ai/console/device?user_code=ABCD-EFGH",
  );
});

test("rejects non-HTTP Console verification URLs", () => {
  assert.throws(() => resolveConsoleVerificationUrl(DEFAULT_CONSOLE_SERVER, "javascript:alert(1)"), /non-HTTP/);
  assert.throws(() => resolveConsoleVerificationUrl(DEFAULT_CONSOLE_SERVER, "http://["), /invalid verification URL/);
});

test("uses OpenCode gateway authentication conventions", () => {
  assert.deepEqual(buildAuthHeaders("chat-completions", "key"), { Authorization: "Bearer key" });
  assert.deepEqual(buildAuthHeaders("messages", "key"), { "x-api-key": "key", "anthropic-version": "2023-06-01" });
  assert.equal(endpointUrl("https://example.test/v1/", "responses", "gpt-5"), "https://example.test/v1/responses");
});

test("catalog headers cannot override credentials or request identity", () => {
  const headers = buildRequestHeaders("chat-completions", "key", "agent", "request", "session", {
    Authorization: "catalog credential",
    "User-Agent": "catalog agent",
    "x-opencode-request": "catalog request",
    "x-provider-option": "preserved",
  });
  assert.equal(headers.Authorization, "Bearer key");
  assert.equal(headers["User-Agent"], "agent");
  assert.equal(headers["x-opencode-request"], "request");
  assert.equal(headers["x-provider-option"], "preserved");
});

test("routes known OpenCode model families to their native gateway shape", () => {
  assert.equal(resolveEndpointKind("gpt-5.6-luna", "go"), "responses");
  assert.equal(resolveEndpointKind("gpt-6-astra", "zen"), "responses");
  assert.equal(resolveEndpointKind("claude-fable-5", "zen"), "messages");
  assert.equal(resolveEndpointKind("gemini-3.5-flash", "zen"), "google");
  assert.equal(resolveEndpointKind("grok-4.6", "go"), "responses");
  assert.equal(resolveEndpointKind("grok-build-0.1", "zen"), "responses");
  assert.equal(resolveEndpointKind("muse-spark-1.3", "zen"), "responses");
  assert.equal(resolveEndpointKind("muse-spark-1.2-contributor", "go"), "responses");
  assert.equal(resolveEndpointKind("minimax-m2.7", "go"), "messages");
  assert.equal(resolveEndpointKind("minimax-m3", "go"), "messages");
  assert.equal(resolveEndpointKind("qwen3.7-plus", "go"), "messages");
  assert.equal(resolveEndpointKind("qwen3.7-max", "go"), "messages");
  assert.equal(resolveEndpointKind("qwen3.8-max", "go"), "messages");
  assert.equal(resolveEndpointKind("qwen3.8-flash", "go"), "messages");
  assert.equal(resolveEndpointKind("qwen3.6-plus", "zen"), "messages");
  assert.equal(resolveEndpointKind("qwen3.5-plus", "go"), "messages");
});

test("keeps undiscovered families on the shared chat completions shape", () => {
  assert.equal(resolveEndpointKind("minimax-m3", "zen"), "chat-completions");
  assert.equal(resolveEndpointKind("glm-5.3", "go"), "chat-completions");
  assert.equal(resolveEndpointKind("kimi-k3", "go"), "chat-completions");
  assert.equal(resolveEndpointKind("deepseek-v4-pro", "go"), "chat-completions");
  assert.equal(resolveEndpointKind("hy3", "go"), "chat-completions");
  assert.equal(resolveEndpointKind("hy4-preview", "go"), "chat-completions");
  assert.equal(resolveEndpointKind("hy3-preview", "go"), "chat-completions");
  assert.equal(resolveEndpointKind("longcat-2.0", "go"), "chat-completions");
  assert.equal(resolveEndpointKind("mimo-v2.5", "go"), "chat-completions");
  assert.equal(resolveEndpointKind("omen-alpha", "go"), "chat-completions");
  assert.equal(resolveEndpointKind("big-pickle", "zen"), "chat-completions");
  assert.equal(resolveEndpointKind("nemotron-3-ultra-free", "zen"), "chat-completions");
  assert.equal(resolveEndpointKind("gemini-3.5-flash", "go"), "chat-completions");
});

test("lets catalog package names override family heuristics", () => {
  assert.equal(resolveEndpointKind("custom-model", "go", "@ai-sdk/anthropic"), "messages");
  assert.equal(resolveEndpointKind("custom-model", "go", "@ai-sdk/google"), "google");
  assert.equal(resolveEndpointKind("custom-model", "go", "@ai-sdk/openai"), "responses");
  assert.equal(resolveEndpointKind("grok-4.6", "go", "@ai-sdk/openai-compatible"), "responses");
});

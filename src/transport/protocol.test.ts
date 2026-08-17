import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthHeaders, buildRequestHeaders, endpointUrl, resolveEndpointKind } from "./protocol";

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
  assert.equal(resolveEndpointKind("claude-opus-4-7", "zen"), "messages");
  assert.equal(resolveEndpointKind("gemini-3.5-flash", "zen"), "google");
  assert.equal(resolveEndpointKind("minimax-m2.7", "go"), "messages");
});

import assert from "node:assert/strict";
import test from "node:test";
import type { OpenCodeModel } from "../models/catalog";
import { buildRequestBody, mergeRequestBody } from "./request";

const model: OpenCodeModel = {
  id: "gpt-5.6-sol",
  rawModelId: "gpt-5.6-sol",
  providerId: "opencode",
  name: "GPT-5.6 Sol",
  family: "gpt",
  contextLength: 100_000,
  maxOutputTokens: 8_192,
  reasoning: true,
  imageInput: false,
  toolCalling: true,
  endpoint: "responses",
  baseUrl: "https://example.test/v1",
};

test("builds a stateless Responses request with reasoning and tools", () => {
  const body = buildRequestBody(
    model,
    [{ role: "user", content: "Hello" }],
    [{ type: "message", role: "user", content: "Hello" }],
    [],
    [{ type: "function", name: "lookup", parameters: { type: "object" } }],
    { effort: "medium" },
    4_096,
    "required",
  );
  assert.deepEqual(body, {
    model: "gpt-5.6-sol",
    input: [{ type: "message", role: "user", content: "Hello" }],
    stream: true,
    store: false,
    max_output_tokens: 4_096,
    reasoning: { effort: "medium" },
    tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
    tool_choice: "required",
    parallel_tool_calls: true,
  });
});

test("builds a Chat Completions request with usage and optional tools", () => {
  const chatModel = { ...model, endpoint: "chat-completions" as const };
  const body = buildRequestBody(
    chatModel,
    [{ role: "user", content: "Hello" }],
    [],
    [{ type: "function", function: { name: "lookup", description: "Look up a value", parameters: { type: "object" } } }],
    [],
    { effort: "low" },
    1_024,
    "auto",
  );
  assert.deepEqual(body, {
    model: "gpt-5.6-sol",
    messages: [{ role: "user", content: "Hello" }],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 1_024,
    reasoning_effort: "low",
    tools: [{ type: "function", function: { name: "lookup", description: "Look up a value", parameters: { type: "object" } } }],
    tool_choice: "auto",
  });
});

test("keeps tool-only assistant content provider-compatible", () => {
  const chatModel = { ...model, endpoint: "chat-completions" as const };
  const body = buildRequestBody(
    chatModel,
    [{
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call-1", type: "function", function: { name: "lookup", arguments: "{}" } }],
    }],
    [],
    [],
    [],
    undefined,
    1_024,
    "auto",
  );

  assert.deepEqual(body.messages, [{
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call-1", type: "function", function: { name: "lookup", arguments: "{}" } }],
  }]);
  assert.equal(JSON.stringify(body).includes('"content":null'), false);
});

test("extension request fields override catalog request options", () => {
  const body = buildRequestBody(model, [], [{ type: "message", role: "user", content: "Hello" }], [], [], undefined, 512, "auto");
  const merged = mergeRequestBody({
    model: "catalog-model",
    input: "catalog-input",
    stream: false,
    store: true,
    temperature: 0.2,
  }, body);
  assert.equal(merged.model, "gpt-5.6-sol");
  assert.deepEqual(merged.input, [{ type: "message", role: "user", content: "Hello" }]);
  assert.equal(merged.stream, true);
  assert.equal(merged.store, false);
  assert.equal(merged.temperature, 0.2);
});

test("preserves Google reasoning history and tool names", () => {
  const body = buildRequestBody(
    { ...model, endpoint: "google" },
    [
      { role: "assistant", content: "Calling lookup", reasoning_content: "Need current data", tool_calls: [{ id: "call-1", type: "function", function: { name: "lookup", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call-1", content: "result" },
    ],
    [], [], [], undefined, 512, "auto",
  );
  assert.deepEqual(body.contents, [
    { role: "model", parts: [{ text: "Need current data", thought: true }, { text: "Calling lookup" }, { functionCall: { name: "lookup", args: {} } }] },
    { role: "user", parts: [{ functionResponse: { name: "lookup", response: { content: "result" } } }] },
  ]);
});

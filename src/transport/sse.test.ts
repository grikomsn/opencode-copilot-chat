import assert from "node:assert/strict";
import test from "node:test";
import { OpenCodeStreamParser } from "./sse";

test("reassembles fragmented chat text and tool arguments", () => {
  const parser = new OpenCodeStreamParser("chat-completions");
  assert.deepEqual(parser.push('data: {"choices":[{"delta":{"content":"hel'), []);
  const first = parser.push(
    'lo"}}]}\n\ndata: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call", function: { name: "lookup", arguments: "{" } }] } }] }) + "\n\n",
  );
  assert.equal(first[0]?.text, "hello");
  const last = parser.push("data: " + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] }, finish_reason: "tool_calls" }] }) + "\n\n");
  assert.equal(last[0]?.toolCalls?.[0]?.arguments, "{}");
});

test("parses Responses API text and completion events", () => {
  const parser = new OpenCodeStreamParser("responses");
  assert.deepEqual(parser.push("event: response.output_text.delta\ndata: {\"delta\":\"hello\"}\n\n"), [{ text: "hello" }]);
  assert.deepEqual(parser.push("event: response.completed\ndata: {\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":2}}}\n\n"), [{ usage: { input_tokens: 2 }, finishReason: "stop", done: true }]);
});

test("flushes Responses API tool calls with the completion event", () => {
  const parser = new OpenCodeStreamParser("responses");
  parser.push("event: response.output_item.added\ndata: {\"item\":{\"type\":\"function_call\",\"call_id\":\"call-1\",\"name\":\"lookup\"}}\n\n");
  parser.push("event: response.function_call_arguments.delta\ndata: {\"call_id\":\"call-1\",\"delta\":\"{}\"}\n\n");
  assert.deepEqual(parser.push("event: response.completed\ndata: {\"response\":{\"status\":\"completed\"}}\n\n"), [{ toolCalls: [{ id: "call-1", name: "lookup", arguments: "{}" }], finishReason: "stop", done: true }]);
});

test("parses CRLF boundaries split across transport chunks", () => {
  const parser = new OpenCodeStreamParser("chat-completions");
  assert.deepEqual(parser.push('data: {"choices":[{"delta":{"content":"hello"}}]}\r'), []);
  assert.deepEqual(parser.push("\n\r\n"), [{ text: "hello" }]);
});

test("parses Messages text, reasoning, and tool calls", () => {
  const parser = new OpenCodeStreamParser("messages");
  assert.deepEqual(parser.push('data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"why"}}\n\n'), [{ reasoning: "why" }]);
  parser.push('data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call-1","name":"lookup"}}\n\n');
  parser.push('data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n');
  assert.deepEqual(parser.push('data: {"type":"message_stop"}\n\n'), [{ done: true, finishReason: "stop", toolCalls: [{ id: "call-1", name: "lookup", arguments: "{}" }] }]);
});

test("merges Messages usage across start and delta events", () => {
  const parser = new OpenCodeStreamParser("messages");
  parser.push('data: {"type":"message_start","message":{"usage":{"input_tokens":12}}}\n\n');
  parser.push('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n');
  assert.deepEqual(parser.push('data: {"type":"message_stop"}\n\n'), [{ done: true, finishReason: "end_turn", toolCalls: [], usage: { input_tokens: 12, output_tokens: 3 } }]);
});

test("parses Google text, reasoning, tool calls, and usage", () => {
  const parser = new OpenCodeStreamParser("google");
  assert.deepEqual(parser.push('data: {"candidates":[{"content":{"parts":[{"text":"why","thought":true},{"text":"hello"},{"functionCall":{"name":"lookup","args":{"id":1}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":2}}\n\n'), [{
    text: "hello",
    reasoning: "why",
    toolCalls: [{ id: "google-tool-2", name: "lookup", arguments: '{"id":1}' }],
    usage: { promptTokenCount: 2 },
    finishReason: "STOP",
  }]);
});

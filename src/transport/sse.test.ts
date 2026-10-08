import assert from "node:assert/strict";
import test from "node:test";
import { OpenCodeStreamParser, validateStreamCompletion } from "./sse";

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

test("recovers Responses API text from the completion event when deltas are absent", () => {
  const parser = new OpenCodeStreamParser("responses");
  const events = parser.push('event: response.completed\ndata: {"response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"final answer"}]}]}}\n\n');
  assert.equal(events[0].text, "final answer");
  assert.equal(parser.completed, true);
});

test("does not repeat completed Responses API text after a delta", () => {
  const parser = new OpenCodeStreamParser("responses");
  parser.push('event: response.output_text.delta\ndata: {"delta":"answer"}\n\n');
  const events = parser.push('event: response.completed\ndata: {"response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"answer"}]}]}}\n\n');
  assert.equal(events[0].text, undefined);
});

test("rejects truncated tool arguments instead of emitting a malformed call", () => {
  const parser = new OpenCodeStreamParser("chat-completions");
  parser.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call","function":{"name":"lookup","arguments":"{\\"city\\":\\"Jak"}}]}}]}\n\n');
  assert.throws(() => parser.finish(), /incomplete arguments for tool lookup/);
});

test("normalizes a complete empty tool argument payload", () => {
  const parser = new OpenCodeStreamParser("chat-completions");
  const events = parser.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call","function":{"name":"now","arguments":""}}]},"finish_reason":"tool_calls"}]}\n\n');
  assert.equal(events[0].toolCalls?.[0].arguments, "{}");
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
    toolCalls: [{ id: "", name: "lookup", arguments: '{"id":1}' }],
    usage: { promptTokenCount: 2 },
    finishReason: "STOP",
  }]);
});

test("accepts dialect-specific success finish reasons", () => {
  for (const reason of ["stop", "tool_calls", "function_call", "end_turn", "tool_use", "stop_sequence", "STOP", "pause_turn"]) {
    assert.doesNotThrow(() => validateStreamCompletion("zen-x", reason));
  }
});

test("surfaces output-limit finish reasons instead of a silent truncation", () => {
  for (const reason of ["length", "max_tokens", "max_output_tokens", "MAX_TOKENS"]) {
    assert.throws(() => validateStreamCompletion("zen-x", reason), /output token limit/);
  }
});

test("surfaces content-filter finish reasons", () => {
  for (const reason of ["content_filter", "SAFETY", "recitation", "blocklist", "prohibited_content", "spii", "refusal"]) {
    assert.throws(() => validateStreamCompletion("zen-x", reason), /content filter/);
  }
});

test("flags a truncated stream that never reported a completion reason", () => {
  assert.throws(() => validateStreamCompletion("zen-x", undefined), /ended before zen-x reported a completion reason/);
});

test("detects a chat stream that ends after partial text with no finish reason", () => {
  const parser = new OpenCodeStreamParser("chat-completions");
  parser.push('data: {"choices":[{"delta":{"content":"partial answer"}}]}\n\n');
  parser.finish();
  assert.equal(parser.completed, false);
  assert.throws(() => validateStreamCompletion("zen-x", parser.finishReason), /ended before zen-x reported a completion reason/);
});

test("emits parallel Responses tool calls individually as each completes", () => {
  const parser = new OpenCodeStreamParser("responses");
  parser.push('event: response.output_item.added\ndata: {"item":{"type":"function_call","call_id":"call-a","name":"lookup"}}\n\n');
  parser.push('event: response.output_item.added\ndata: {"item":{"type":"function_call","call_id":"call-b","name":"weather"}}\n\n');
  parser.push('event: response.function_call_arguments.delta\ndata: {"call_id":"call-a","delta":"{\\"q\\":\\"x\\"}"}\n\n');
  parser.push('event: response.function_call_arguments.delta\ndata: {"call_id":"call-b","delta":"{\\"city\\":\\"Par"}\n\n');
  // call-a finishes while call-b is mid-accumulation: this must emit only
  // call-a instead of aborting the stream on call-b's incomplete arguments.
  const doneA = parser.push('event: response.function_call_arguments.done\ndata: {"call_id":"call-a","arguments":"{\\"q\\":\\"x\\"}"}\n\n');
  assert.deepEqual(doneA, [{ toolCalls: [{ id: "call-a", name: "lookup", arguments: '{"q":"x"}' }] }]);
  const doneB = parser.push('event: response.function_call_arguments.done\ndata: {"call_id":"call-b","arguments":"{\\"city\\":\\"Paris\\"}"}\n\n');
  assert.deepEqual(doneB, [{ toolCalls: [{ id: "call-b", name: "weather", arguments: '{"city":"Paris"}' }] }]);
  const completed = parser.push('event: response.completed\ndata: {"response":{"status":"completed","usage":{"input_tokens":2}}}\n\n');
  assert.equal(completed[0]?.toolCalls, undefined);
  assert.equal(parser.completed, true);
});

test("a completed message item does not flush still-streaming sibling tool calls", () => {
  const parser = new OpenCodeStreamParser("responses");
  parser.push('event: response.output_item.added\ndata: {"item":{"type":"function_call","call_id":"call-a","name":"lookup"}}\n\n');
  parser.push('event: response.function_call_arguments.delta\ndata: {"call_id":"call-a","delta":"{\\"q\\":\\"x\\"}"}\n\n');
  const messageDone = parser.push('event: response.output_item.done\ndata: {"item":{"type":"message","id":"msg-1","content":[{"type":"output_text","text":"hi"}]}}\n\n');
  assert.deepEqual(messageDone, []);
  const completed = parser.push('event: response.completed\ndata: {"response":{"status":"completed"}}\n\n');
  assert.deepEqual(completed[0]?.toolCalls, [{ id: "call-a", name: "lookup", arguments: '{"q":"x"}' }]);
});

test("keeps incomplete parallel siblings pending instead of aborting mid-stream", () => {
  const parser = new OpenCodeStreamParser("responses");
  parser.push('event: response.output_item.added\ndata: {"item":{"type":"function_call","call_id":"call-a","name":"lookup"}}\n\n');
  parser.push('event: response.output_item.added\ndata: {"item":{"type":"function_call","call_id":"call-b","name":"weather"}}\n\n');
  parser.push('event: response.function_call_arguments.delta\ndata: {"call_id":"call-a","delta":"{\\"q\\":\\"x\\"}"}\n\n');
  parser.push('event: response.function_call_arguments.delta\ndata: {"call_id":"call-b","delta":"{\\"city\\":\\"Par"}\n\n');
  // Invalid sibling arguments at call-a's done event must not throw.
  const doneA = parser.push('event: response.function_call_arguments.done\ndata: {"call_id":"call-a","arguments":"{\\"q\\":\\"x\\"}"}\n\n');
  assert.deepEqual(doneA, [{ toolCalls: [{ id: "call-a", name: "lookup", arguments: '{"q":"x"}' }] }]);
  parser.push('event: response.function_call_arguments.delta\ndata: {"call_id":"call-b","delta":"is\\"}"}\n\n');
  const doneB = parser.push('event: response.function_call_arguments.done\ndata: {"call_id":"call-b","arguments":"{\\"city\\":\\"Paris\\"}"}\n\n');
  assert.deepEqual(doneB, [{ toolCalls: [{ id: "call-b", name: "weather", arguments: '{"city":"Paris"}' }] }]);
});

test("accumulates chat tool deltas under the tool id when the gateway omits index", () => {
  const parser = new OpenCodeStreamParser("chat-completions");
  parser.push('data: {"choices":[{"delta":{"tool_calls":[{"id":"call-a","function":{"name":"lookup","arguments":"{\\"q\\":"}}]}}]}\n\n');
  parser.push('data: {"choices":[{"delta":{"tool_calls":[{"id":"call-a","function":{"arguments":"\\"x\\"}"}}]}}]}\n\n');
  const events = parser.push('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
  assert.deepEqual(events, [{ finishReason: "tool_calls", toolCalls: [{ id: "call-a", name: "lookup", arguments: '{"q":"x"}' }] }]);
});

function responseEvent(parser: OpenCodeStreamParser, type: string, payload: Record<string, unknown>): ReturnType<OpenCodeStreamParser["push"]> {
  return parser.push(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

test("keeps parallel chat calls intact when later deltas omit their indexes", () => {
  const parser = new OpenCodeStreamParser("chat-completions");
  const chat = (calls: Record<string, unknown>[]) => parser.push(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls } }] })}\n\n`);
  chat([
    { index: 0, id: "call-a", function: { name: "read", arguments: '{"path":' } },
    { index: 1, id: "call-b", function: { name: "read", arguments: '{"path":' } },
  ]);
  chat([{ id: "call-b", function: { arguments: '"b"}' } }]);
  chat([{ id: "call-a", function: { arguments: '"a"' } }]);
  chat([{ index: 0, function: { arguments: "}" } }]);
  assert.deepEqual(parser.push('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n')[0].toolCalls, [
    { id: "call-a", name: "read", arguments: '{"path":"a"}' },
    { id: "call-b", name: "read", arguments: '{"path":"b"}' },
  ]);
  assert.deepEqual(parser.finish(), []);
});

test("joins parallel Responses item IDs to the call IDs required for tool results", () => {
  const parser = new OpenCodeStreamParser("responses");
  for (const [index, suffix] of ["a", "b"].entries()) {
    responseEvent(parser, "response.output_item.added", { output_index: index, item: {
      type: "function_call", id: `fc-${suffix}`, call_id: `call-${suffix}`, name: "read", arguments: "",
    } });
  }
  responseEvent(parser, "response.function_call_arguments.delta", { item_id: "fc-a", output_index: 0, delta: '{"path":"a"}' });
  responseEvent(parser, "response.function_call_arguments.delta", { item_id: "fc-b", output_index: 1, delta: '{"path":' });
  assert.deepEqual(responseEvent(parser, "response.function_call_arguments.done", { item_id: "fc-a", output_index: 0, arguments: '{"path":"a"}' }), [
    { toolCalls: [{ id: "call-a", name: "read", arguments: '{"path":"a"}' }] },
  ]);
  responseEvent(parser, "response.output_item.done", { output_index: 0, item: {
    type: "function_call", id: "fc-a", call_id: "call-a", name: "read", arguments: '{"path":"a"}',
  } });
  assert.deepEqual(responseEvent(parser, "response.function_call_arguments.done", { item_id: "fc-a", name: "read", arguments: '{"path":"a"}' }), []);
  assert.deepEqual(responseEvent(parser, "response.function_call_arguments.delta", { item_id: "fc-a", name: "read", delta: '{"path":"a"}' }), []);
  responseEvent(parser, "response.function_call_arguments.delta", { item_id: "fc-b", output_index: 1, delta: '"b"}' });
  assert.deepEqual(responseEvent(parser, "response.function_call_arguments.done", { item_id: "fc-b", output_index: 1, arguments: '{"path":"b"}' }), [
    { toolCalls: [{ id: "call-b", name: "read", arguments: '{"path":"b"}' }] },
  ]);
  assert.deepEqual(responseEvent(parser, "response.completed", { response: { status: "completed" } }), [{ finishReason: "stop", done: true }]);
  assert.deepEqual(parser.finish(), []);
});

test("uses numeric output indexes to route Responses deltas when IDs are omitted", () => {
  const parser = new OpenCodeStreamParser("responses");
  for (const [index, suffix] of ["a", "b"].entries()) {
    responseEvent(parser, "response.output_item.added", { output_index: index, item: {
      type: "function_call", id: `fc-${suffix}`, call_id: `call-${suffix}`, name: "read",
    } });
  }
  responseEvent(parser, "response.function_call_arguments.delta", { output_index: 1, delta: '{"path":"b"}' });
  responseEvent(parser, "response.function_call_arguments.delta", { output_index: 0, delta: '{"path":"a"}' });
  assert.deepEqual(responseEvent(parser, "response.completed", { response: { status: "completed" } })[0].toolCalls, [
    { id: "call-a", name: "read", arguments: '{"path":"a"}' },
    { id: "call-b", name: "read", arguments: '{"path":"b"}' },
  ]);
});

test("recognizes a final completion block without a trailing SSE separator", () => {
  const parser = new OpenCodeStreamParser("chat-completions");
  assert.deepEqual(parser.push('data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}'), []);
  assert.deepEqual(parser.finish(), [{ text: "answer", finishReason: "stop" }]);
  assert.doesNotThrow(() => validateStreamCompletion("model", parser.finishReason));
});

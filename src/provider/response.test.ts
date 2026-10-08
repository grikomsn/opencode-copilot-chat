import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";
import { StreamResponseReporter, type ResponsePartConstructors } from "./response";
import { OpenCodeStreamParser } from "../transport/sse";

class TextPart {
  constructor(readonly value: string) {}
}
class ThinkingPart {
  constructor(readonly value: string | string[], readonly id?: string, readonly metadata?: Record<string, unknown>) {}
}
class ToolPart {
  constructor(readonly callId: string, readonly name: string, readonly input: object) {}
}
class DataPart {
  constructor(readonly data: Uint8Array, readonly mimeType: string) {}
}
type Part = TextPart | ThinkingPart | ToolPart | DataPart;

function harness(thinkingAvailable = true): { reporter: StreamResponseReporter; parts: Part[] } {
  const parts: Part[] = [];
  const constructors = {
    LanguageModelTextPart: TextPart,
    LanguageModelThinkingPart: thinkingAvailable ? ThinkingPart : undefined,
    LanguageModelToolCallPart: ToolPart,
    LanguageModelDataPart: DataPart,
  } as ResponsePartConstructors;
  const progress = { report: (part: vscode.LanguageModelResponsePart2) => parts.push(part as Part) };
  return { parts, reporter: new StreamResponseReporter(progress, "glm-5.3-flash", constructors, "request", (name) => name.replace("safe_", "")) };
}

test("keeps a mixed SSE reasoning/text/tool event in conversational order", () => {
  const { reporter, parts } = harness();
  const parser = new OpenCodeStreamParser("chat-completions");
  const events = parser.push(`data: ${JSON.stringify({ choices: [{ delta: {
    reasoning_content: "Finish thinking.", content: "Read both files.",
    tool_calls: [
      { index: 0, id: "a", function: { name: "safe_read", arguments: '{"path":"a"}' } },
      { index: 1, id: "b", function: { name: "safe_read", arguments: '{"path":"b"}' } },
    ],
  }, finish_reason: "tool_calls" }] })}\n\n`);
  for (const event of events) reporter.report(event);
  assert.deepEqual(parts, [
    new ThinkingPart("Finish thinking."),
    new ThinkingPart("", "", { vscode_reasoning_done: true }),
    new TextPart("Read both files."),
    new ToolPart("a", "read", { path: "a" }),
    new ToolPart("b", "read", { path: "b" }),
  ]);
});

test("usage updates do not split thinking and parallel tools close it once", () => {
  const { reporter, parts } = harness();
  reporter.report({ reasoning: "First " });
  const usage = reporter.report({ usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } });
  assert.equal(usage?.totalTokens, 5);
  reporter.report({ reasoning: "second." });
  reporter.report({ toolCalls: [
    { id: "a", name: "read", arguments: "{}" },
    { id: "b", name: "read", arguments: "{}" },
  ] });
  reporter.finish();
  assert.deepEqual(parts.filter((part) => !(part instanceof DataPart)), [
    new ThinkingPart("First "), new ThinkingPart("second."),
    new ThinkingPart("", "", { vscode_reasoning_done: true }),
    new ToolPart("a", "read", {}), new ToolPart("b", "read", {}),
  ]);
  const data = parts.filter((part): part is DataPart => part instanceof DataPart);
  assert.deepEqual(data.map((part) => part.mimeType), ["usage", "application/vnd.opencode.usage+json"]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(data[0].data)), { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 });
});

test("closes thinking on completion and EOF without duplicating markers", () => {
  for (const terminal of [{ done: true }, { finishReason: "stop" }, {}]) {
    const { reporter, parts } = harness();
    reporter.report({ reasoning: "Reasoning" });
    reporter.report(terminal);
    reporter.finish();
    reporter.finish();
    assert.deepEqual(parts, [new ThinkingPart("Reasoning"), new ThinkingPart("", "", { vscode_reasoning_done: true })]);
  }
});

test("starts a fresh thinking segment after visible output", () => {
  const { reporter, parts } = harness();
  reporter.report({ reasoning: "First", text: "Answer" });
  reporter.report({ reasoning: "Second" });
  reporter.finish();
  assert.equal(parts.filter((part) => part instanceof ThinkingPart && part.metadata?.vscode_reasoning_done).length, 2);
});

test("reports visible output when the host does not expose thinking parts", () => {
  const { reporter, parts } = harness(false);
  reporter.report({ reasoning: "Reasoning", text: "Answer", done: true });
  reporter.finish();
  assert.deepEqual(parts, [new TextPart("Answer")]);
});

test("creates distinct fallback IDs for simultaneous tool calls", () => {
  const { reporter, parts } = harness();
  reporter.report({ toolCalls: [{ id: "", name: "a", arguments: "{}" }, { id: "", name: "b", arguments: "{}" }] });
  assert.deepEqual(parts.map((part) => (part as ToolPart).callId), ["opencode-tool-request-0", "opencode-tool-request-1"]);
});

test("preserves upstream Google call IDs and assigns unique IDs across SSE events", () => {
  const { reporter, parts } = harness();
  const parser = new OpenCodeStreamParser("google");
  for (const id of [undefined, undefined, "upstream"]) {
    const payload = { candidates: [{ content: { parts: [{ functionCall: { id, name: "read", args: {} } }] } }] };
    for (const event of parser.push(`data: ${JSON.stringify(payload)}\n\n`)) reporter.report(event);
  }
  assert.deepEqual(parts.map((part) => (part as ToolPart).callId), ["opencode-tool-request-0", "opencode-tool-request-1", "upstream"]);
});

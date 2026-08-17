import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeToolSchema } from "./schema";

test("resolves local references and removes unsupported schema metadata", () => {
  assert.deepEqual(sanitizeToolSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { value: { $ref: "#/$defs/value" } },
    required: ["value"],
    $defs: { value: { type: "string", minLength: 1 } },
  }), {
    type: "object",
    properties: { value: { type: "string", minLength: 1 } },
    required: ["value"],
  });
});

test("terminates safely for recursive object graphs", () => {
  const recursive: Record<string, unknown> = { type: "object", properties: {} };
  recursive.properties = { child: recursive };
  assert.deepEqual(sanitizeToolSchema(recursive), { type: "object", properties: { child: {} } });
});

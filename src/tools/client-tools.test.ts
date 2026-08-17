import assert from "node:assert/strict";
import test from "node:test";
import { originalToolName, providerToolName } from "./client-tools";

test("aliases overlong provider tool names and restores the VS Code name", () => {
  const original = "tool_" + "x".repeat(70);
  const alias = providerToolName(original);
  assert.equal(alias.length, 64);
  assert.equal(providerToolName(original), alias);
  assert.equal(originalToolName(alias, [{ name: original, description: "", inputSchema: {} }]), original);
});

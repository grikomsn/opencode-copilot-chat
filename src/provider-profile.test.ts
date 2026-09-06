import assert from "node:assert/strict";
import test from "node:test";
import {
  activeConsoleProfileFromState,
  consoleProfileFromConfiguration,
  qualifiedModelId,
} from "./provider-profile";

test("normalizes native provider-entry console profiles", () => {
  assert.equal(consoleProfileFromConfiguration({ profile: "  Work-Team  " }), "work-team");
  assert.equal(consoleProfileFromConfiguration(undefined), "default");
  assert.equal(consoleProfileFromConfiguration({}), "default");
  assert.equal(consoleProfileFromConfiguration({ profile: 42 }), "default");
});

test("reports provider-entry guidance when a console profile is invalid", () => {
  assert.throws(
    () => consoleProfileFromConfiguration({ profile: "bad profile!" }),
    /Invalid OpenCode Console profile\. Update this provider entry in Manage Language Models\./,
  );
});

test("keeps legacy and native provider-entry model IDs distinct", () => {
  assert.equal(qualifiedModelId("legacy", "qwen3.7-plus"), "qwen3.7-plus");
  assert.equal(qualifiedModelId("profile-default", "qwen3.7-plus"), "qwen3.7-plus");
  assert.equal(qualifiedModelId("profile-work", "qwen3.7-plus"), "profile-work::qwen3.7-plus");
  assert.equal(qualifiedModelId("key-abc123", "glm-5.3"), "key-abc123::glm-5.3");
});

test("restores the default console profile when persisted state is unusable", () => {
  assert.equal(activeConsoleProfileFromState("  Work  "), "work");
  assert.equal(activeConsoleProfileFromState("bad profile!"), "default");
  assert.equal(activeConsoleProfileFromState(42), "default");
  assert.equal(activeConsoleProfileFromState(undefined), "default");
});

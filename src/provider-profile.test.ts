import assert from "node:assert/strict";
import test from "node:test";
import {
  activeConsoleProfileFromState,
  apiKeyCredentialId,
  consoleProfileFromConfiguration,
  entryNameFromConfiguration,
  qualifiedModelId,
  stableEntryCredentialId,
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

test("qualifies model IDs per mode so same-vendor entries cannot collide", () => {
  // Command-managed Go credentials and the default Console device profile
  // keep unqualified IDs for compatibility; everything else is qualified.
  assert.equal(qualifiedModelId("legacy", "qwen3.7-plus", "go"), "qwen3.7-plus");
  assert.equal(qualifiedModelId("legacy", "qwen3.7-plus", "console"), "legacy::qwen3.7-plus");
  assert.equal(qualifiedModelId("profile-default", "qwen3.7-plus", "console"), "qwen3.7-plus");
  assert.equal(qualifiedModelId("profile-default", "qwen3.7-plus", "go"), "profile-default::qwen3.7-plus");
  assert.equal(qualifiedModelId("profile-work", "qwen3.7-plus", "console"), "profile-work::qwen3.7-plus");
  assert.equal(qualifiedModelId("key-abc123", "glm-5.3", "go"), "key-abc123::glm-5.3");
});

test("matches the legacy credential only when the key equals the default account key", () => {
  assert.equal(apiKeyCredentialId("shared-key", "shared-key"), "legacy");
  assert.match(apiKeyCredentialId("solo-key", "shared-key"), /^key-[0-9a-f]{16}$/);
  assert.notEqual(apiKeyCredentialId("solo-key", "shared-key"), "legacy");
  // The derived identity is a pure function of the key unless it matches.
  assert.equal(apiKeyCredentialId("dup", "nope"), apiKeyCredentialId("dup"));
  assert.notEqual(apiKeyCredentialId("dup", "nope"), apiKeyCredentialId("dup-2"));
});

test("derives stable entry credential IDs from a validated label", () => {
  assert.equal(stableEntryCredentialId("Work.Team-1"), "entry-work.team-1");
  assert.equal(entryNameFromConfiguration({ name: " Work " }), "work");
  assert.equal(entryNameFromConfiguration({ name: "  " }), undefined);
  assert.equal(entryNameFromConfiguration({ name: 42 }), undefined);
  assert.equal(entryNameFromConfiguration(undefined), undefined);
  assert.throws(
    () => entryNameFromConfiguration({ name: "bad label!" }),
    /Invalid OpenCode provider entry label\. Update this provider entry in Manage Language Models\./,
  );
});

test("restores the default console profile when persisted state is unusable", () => {
  assert.equal(activeConsoleProfileFromState("  Work  "), "work");
  assert.equal(activeConsoleProfileFromState("bad profile!"), "default");
  assert.equal(activeConsoleProfileFromState(42), "default");
  assert.equal(activeConsoleProfileFromState(undefined), "default");
});

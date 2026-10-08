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

test("reads provider-entry profile aliases leniently", () => {
  assert.equal(consoleProfileFromConfiguration({ profile: "  Work-Team  " }), "work-team");
  // Users may keep arbitrary distinct strings (even raw workspace IDs) purely
  // to tell entries apart; they name no signed-in account until sign-in.
  assert.equal(consoleProfileFromConfiguration({ profile: "org_01M07AD00NAWYBRZZBEX395FD7" }), "org_01m07ad00nawybrzzbex395fd7");
  assert.equal(consoleProfileFromConfiguration({ profile: "bad profile!" }), "bad profile!");
  assert.equal(consoleProfileFromConfiguration(undefined), "default");
  assert.equal(consoleProfileFromConfiguration({}), "default");
  assert.equal(consoleProfileFromConfiguration({ profile: 42 }), "default");
  // Punctuation-only or blank-after-trim values fall back to the default account.
  assert.equal(consoleProfileFromConfiguration({ profile: "!!!" }), "default");
  assert.equal(consoleProfileFromConfiguration({ profile: "   " }), "default");
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

test("hashes key credentials into stable fingerprints", () => {
  assert.match(apiKeyCredentialId("solo-key"), /^key-[0-9a-f]{16}$/);
  assert.notEqual(apiKeyCredentialId("solo-key"), apiKeyCredentialId("solo-key-2"));
  assert.equal(apiKeyCredentialId("dup"), apiKeyCredentialId("dup"));
});

test("derives stable entry labels from VS Code group names without throwing", () => {
  // Group names come from the Language Models editor and may contain spaces
  // and capitals; they fold into a safe slug instead of rejecting entries.
  assert.equal(stableEntryCredentialId("wayfindr-se"), "entry-wayfindr-se");
  assert.equal(entryNameFromConfiguration({ name: "Wayfindr SE" }), "wayfindr-se");
  assert.equal(entryNameFromConfiguration({ name: "Nibras Enterprises" }), "nibras-enterprises");
  assert.equal(entryNameFromConfiguration({ name: "  Work  " }), "work");
  assert.equal(entryNameFromConfiguration({ name: "  " }), undefined);
  assert.equal(entryNameFromConfiguration({ name: 42 }), undefined);
  assert.equal(entryNameFromConfiguration(undefined), undefined);
  // Names with no usable characters fall back to the key fingerprint rather
  // than erroring the whole entry.
  assert.equal(entryNameFromConfiguration({ name: "!!!" }), undefined);
});

test("restores the default console profile when persisted state is unusable", () => {
  assert.equal(activeConsoleProfileFromState("  Work  "), "work");
  assert.equal(activeConsoleProfileFromState("bad profile!"), "default");
  assert.equal(activeConsoleProfileFromState(42), "default");
  assert.equal(activeConsoleProfileFromState(undefined), "default");
});

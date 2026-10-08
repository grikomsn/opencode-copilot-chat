import assert from "node:assert/strict";
import test from "node:test";
import { activeConsoleProfileFromState, apiKeyCredentialId, consoleProfileFromConfiguration, entryIdFromConfiguration, qualifiedModelId, stableEntryCredentialId } from "./provider-profile";

test("validates account aliases without routing malformed profiles to default", () => {
  assert.equal(consoleProfileFromConfiguration({ profile: "  Work-Team  " }), "work-team");
  assert.equal(consoleProfileFromConfiguration({}), "default");
  for (const profile of ["bad profile!", "!!!", 42, "x".repeat(65)]) assert.throws(() => consoleProfileFromConfiguration({ profile }));
});

test("requires explicit native IDs independently of display names", () => {
  assert.equal(entryIdFromConfiguration({ entryId: "a-b", name: "A B" }), "a-b");
  assert.equal(entryIdFromConfiguration({ entryId: "a.b", name: "A-B" }), "a.b");
  for (const entryId of [undefined, "A B", "A-B", "", "x".repeat(65)]) assert.throws(() => entryIdFromConfiguration({ entryId, name: "work" }), /unique entryId/);
  assert.equal(stableEntryCredentialId("work"), "entry-work");
});

test("keeps selection IDs stable on rotation while isolating credential scopes", () => {
  assert.equal(qualifiedModelId(stableEntryCredentialId("work"), "glm", "go"), "entry-work::glm");
  assert.equal(qualifiedModelId("profile-default", "glm", "console"), "profile-default::glm");
  assert.notEqual(apiKeyCredentialId("first"), apiKeyCredentialId("rotated"));
  assert.equal(apiKeyCredentialId("shared"), apiKeyCredentialId("shared"));
  assert.match(apiKeyCredentialId("key"), /^key-[0-9a-f]{16}$/);
});

test("restores command state defensively", () => {
  assert.equal(activeConsoleProfileFromState("  Work  "), "work");
  assert.equal(activeConsoleProfileFromState("bad profile!"), "default");
});

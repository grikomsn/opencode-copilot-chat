import assert from "node:assert/strict";
import test from "node:test";
import { activeConsoleProfileFromState, apiKeyCredentialId, consoleProfileFromConfiguration, qualifiedModelId } from "./provider-profile";

test("validates account aliases without routing malformed profiles to default", () => {
  assert.equal(consoleProfileFromConfiguration({ profile: "  Work-Team  " }), "work-team");
  assert.equal(consoleProfileFromConfiguration({}), "default");
  for (const profile of ["bad profile!", "!!!", 42, "x".repeat(65)]) assert.throws(() => consoleProfileFromConfiguration({ profile }));
});

test("keeps key fingerprints stable while model IDs stay raw", () => {
  assert.equal(qualifiedModelId("ignored", "glm", "go"), "glm");
  assert.equal(qualifiedModelId("profile-default", "glm", "console"), "glm");
  assert.notEqual(apiKeyCredentialId("first"), apiKeyCredentialId("rotated"));
  assert.equal(apiKeyCredentialId("shared"), apiKeyCredentialId("shared"));
  assert.match(apiKeyCredentialId("key"), /^key-[0-9a-f]{16}$/);
});

test("restores command state defensively", () => {
  assert.equal(activeConsoleProfileFromState("  Work  "), "work");
  assert.equal(activeConsoleProfileFromState("bad profile!"), "default");
});

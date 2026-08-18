import assert from "node:assert/strict";
import test from "node:test";
import type { Credential } from "../auth/auth";
import { apiKeyCredentialId, managementCredentialOptions, resolveManagementCredential } from "./management";

test("builds secret-safe management choices for native and legacy credentials", () => {
  const credentialId = apiKeyCredentialId("native-secret-key");
  const options = managementCredentialOptions([credentialId], true);

  assert.match(credentialId, /^key-[a-f0-9]{16}$/);
  assert.deepEqual(options, [
    {
      credentialId,
      label: `Native provider entry · ${credentialId.slice(4, 12)}`,
      description: "Stored by VS Code Manage Language Models",
    },
    {
      credentialId: "legacy",
      label: "Legacy command-managed credential",
      description: "Stored by the OpenCode sign-in command",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(options), /native-secret-key/);
});

test("resolves the explicitly selected native or legacy management credential", () => {
  const native: Credential = { mode: "zen", token: "native" };
  const legacy: Credential = { mode: "zen", token: "legacy" };
  const credentials = new Map([["key-native", native]]);

  assert.equal(resolveManagementCredential("key-native", credentials, legacy), native);
  assert.equal(resolveManagementCredential("legacy", credentials, legacy), legacy);
  assert.equal(resolveManagementCredential("key-missing", credentials, legacy), undefined);
});

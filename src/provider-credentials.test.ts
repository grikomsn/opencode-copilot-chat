import assert from "node:assert/strict";
import test from "node:test";
import { NativeKeyEntries } from "./provider-credentials";
import { apiKeyCredentialId } from "./provider-profile";
import type { Credential } from "./auth/auth";
const credential = (token: string): Credential => ({ token, mode: "go", origin: "key" });

test("key-scoped credentials stay valid while their key stays provisioned", () => {
  const entries = new NativeKeyEntries();
  const first = apiKeyCredentialId("first");
  const personal = apiKeyCredentialId("personal");
  const rotated = apiKeyCredentialId("rotated");
  entries.register(first, credential("first"));
  entries.register(personal, credential("personal"));
  entries.register(rotated, credential("rotated"));
  assert.equal(entries.get(first)?.token, "first");
  assert.equal(entries.get(personal)?.token, "personal");
  assert.equal(entries.get(rotated)?.token, "rotated");
});

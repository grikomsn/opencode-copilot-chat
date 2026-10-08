import assert from "node:assert/strict";
import test from "node:test";
import { NativeKeyEntries } from "./provider-credentials";
import { apiKeyCredentialId } from "./provider-profile";
import type { Credential } from "./auth/auth";
const credential = (token: string): Credential => ({ token, mode: "go", origin: "key" });

test("rotation retires old credential scopes while another entry stays isolated", () => {
  const entries = new NativeKeyEntries();
  const first = apiKeyCredentialId("first");
  const personal = apiKeyCredentialId("personal");
  const rotated = apiKeyCredentialId("rotated");
  entries.register("work", first, credential("first"));
  entries.register("personal", personal, credential("personal"));
  assert.equal(entries.register("work", rotated, credential("rotated")), first);
  assert.equal(entries.get(first), undefined);
  assert.equal(entries.get(personal)?.token, "personal");
  assert.equal(entries.get(rotated)?.token, "rotated");
});

test("shared keys survive rename/removal and duplicate selection IDs cannot reroute stale models", () => {
  const entries = new NativeKeyEntries();
  entries.register("a", "shared", credential("shared"));
  entries.register("b", "shared", credential("shared"));
  entries.forget("a");
  assert.equal(entries.get("shared")?.token, "shared");
  entries.register("b", "different", credential("different"));
  assert.equal(entries.get("shared"), undefined);
  assert.equal(entries.get("different")?.token, "different");
  entries.forget("b");
  assert.equal(entries.get("different"), undefined);
});

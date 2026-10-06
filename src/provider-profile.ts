import { createHash } from "node:crypto";
import { DEFAULT_CONSOLE_PROFILE, normalizeConsoleProfile } from "./auth/auth";
import type { OpenCodeMode } from "./transport/protocol";

export type CredentialOrigin = "key" | "session";

export function consoleProfileFromConfiguration(configuration: Readonly<Record<string, unknown>> | undefined): string {
  try {
    return normalizeConsoleProfile(typeof configuration?.profile === "string" ? configuration.profile : DEFAULT_CONSOLE_PROFILE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid OpenCode Console profile. Update this provider entry in Manage Language Models. ${message}`);
  }
}

/**
 * Validates the optional entry label that keeps native service-key entries on
 * a stable credential identity; absent or empty labels resolve to undefined.
 */
export function entryNameFromConfiguration(configuration: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const value = typeof configuration?.name === "string" ? configuration.name.trim() : "";
  if (!value) return undefined;
  try {
    return normalizeConsoleProfile(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid OpenCode provider entry label. Update this provider entry in Manage Language Models. ${message}`);
  }
}

/**
 * Credential identity for a native API-key entry. A key that matches the
 * default account's stored key for the gateway keeps the historical `legacy`
 * identity so command-managed usage tracking does not fork; other keys are
 * hashed. Use a per-entry label (`stableEntryCredentialId`) when the identity
 * must survive key rotation.
 */
export function apiKeyCredentialId(apiKey: string, legacyToken?: string): string {
  return legacyToken === apiKey ? "legacy" : `key-${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

export function stableEntryCredentialId(name: string): string {
  return `entry-${normalizeConsoleProfile(name)}`;
}

/**
 * Model IDs are qualified per credential so multiple entries of one vendor
 * cannot collide. For compatibility with model selections saved before
 * multi-entry support, only the command-managed Go credential and the default
 * Console device profile keep unqualified IDs; every other credential is
 * qualified.
 */
export function qualifiedModelId(credentialId: string, modelId: string, mode: OpenCodeMode): string {
  const unqualified =
    (mode === "console" && credentialId === `profile-${DEFAULT_CONSOLE_PROFILE}`) ||
    (mode === "go" && credentialId === "legacy");
  return unqualified ? modelId : `${credentialId}::${modelId}`;
}

/** Restores a command-management profile without allowing malformed state to prevent activation. */
export function activeConsoleProfileFromState(value: unknown): string {
  try {
    return typeof value === "string" ? normalizeConsoleProfile(value) : DEFAULT_CONSOLE_PROFILE;
  } catch {
    return DEFAULT_CONSOLE_PROFILE;
  }
}

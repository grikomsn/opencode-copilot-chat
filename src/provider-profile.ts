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
 * Derives a stable credential label from VS Code's provider-entry group
 * name (the `name` field of the stored entry). Spaces and other invalid
 * characters fold into dashes; an unusable result resolves to undefined so
 * the entry falls back to its key fingerprint and never fails over its
 * label.
 */
export function entryNameFromConfiguration(configuration: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const value = typeof configuration?.name === "string" ? configuration.name.trim() : "";
  if (!value) return undefined;
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return /^[a-z0-9]/.test(slug) ? slug : undefined;
}

/**
 * Credential identity for a native API-key entry. Service keys are
 * user-managed in VS Code provider configuration, so entries are identified
 * by their stable group-name label when one exists, and by their key
 * fingerprint otherwise.
 */
export function apiKeyCredentialId(apiKey: string): string {
  return `key-${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
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

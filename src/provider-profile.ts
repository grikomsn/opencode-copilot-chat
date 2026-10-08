import { createHash } from "node:crypto";
import { DEFAULT_CONSOLE_PROFILE, normalizeConsoleProfile } from "./auth/auth";
import type { OpenCodeMode } from "./transport/protocol";

export type CredentialOrigin = "key" | "session";

export function consoleProfileFromConfiguration(configuration: Readonly<Record<string, unknown>> | undefined): string {
  if (configuration?.profile !== undefined && typeof configuration.profile !== "string") throw new Error("Account profile must be a string");
  return normalizeConsoleProfile(typeof configuration?.profile === "string" ? configuration.profile : DEFAULT_CONSOLE_PROFILE);
}

/** Native group names are not supplied to providers. Keys require an explicit stable ID. */
export function entryIdFromConfiguration(configuration: Readonly<Record<string, unknown>>): string {
  const value = configuration.entryId;
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
    throw new Error("Set a unique entryId in Manage Language Models: 1-64 lowercase letters, numbers, dots, underscores, or hyphens");
  }
  return value;
}

/** Authentication and catalog scopes change on rotation, independently of model selection IDs. */
export function apiKeyCredentialId(apiKey: string): string {
  return `key-${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

export function stableEntryCredentialId(entryId: string): string {
  return `entry-${entryIdFromConfiguration({ entryId })}`;
}

export function qualifiedModelId(credentialId: string, modelId: string, _mode: OpenCodeMode): string {
  return `${credentialId}::${modelId}`;
}

export function activeConsoleProfileFromState(value: unknown): string {
  try {
    return typeof value === "string" ? normalizeConsoleProfile(value) : DEFAULT_CONSOLE_PROFILE;
  } catch {
    return DEFAULT_CONSOLE_PROFILE;
  }
}

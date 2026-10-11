import { createHash } from "node:crypto";
import { DEFAULT_CONSOLE_PROFILE, normalizeConsoleProfile } from "./auth/auth";
import type { OpenCodeMode } from "./transport/protocol";

export type CredentialOrigin = "key" | "session";

export function consoleProfileFromConfiguration(configuration: Readonly<Record<string, unknown>> | undefined): string {
  if (configuration?.profile !== undefined && typeof configuration.profile !== "string") throw new Error("Account profile must be a string");
  return normalizeConsoleProfile(typeof configuration?.profile === "string" ? configuration.profile : DEFAULT_CONSOLE_PROFILE);
}

/** Authentication and catalog scopes change on rotation, independently of model selection IDs. */
export function apiKeyCredentialId(apiKey: string): string {
  return `key-${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

/** Model IDs are raw hosted IDs; the host namespaces them per provider entry group. */
export function qualifiedModelId(_credentialId: string, modelId: string, _mode: OpenCodeMode): string {
  return modelId;
}

export function activeConsoleProfileFromState(value: unknown): string {
  try {
    return typeof value === "string" ? normalizeConsoleProfile(value) : DEFAULT_CONSOLE_PROFILE;
  } catch {
    return DEFAULT_CONSOLE_PROFILE;
  }
}

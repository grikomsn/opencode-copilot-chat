import { DEFAULT_CONSOLE_PROFILE, normalizeConsoleProfile } from "./auth/auth";

export function consoleProfileFromConfiguration(configuration: Readonly<Record<string, unknown>> | undefined): string {
  try {
    return normalizeConsoleProfile(typeof configuration?.profile === "string" ? configuration.profile : DEFAULT_CONSOLE_PROFILE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid OpenCode Console profile. Update this provider entry in Manage Language Models. ${message}`);
  }
}

export function qualifiedModelId(credentialId: string, modelId: string): string {
  return credentialId === "legacy" || credentialId === `profile-${DEFAULT_CONSOLE_PROFILE}`
    ? modelId
    : `${credentialId}::${modelId}`;
}

/** Restores a command-management profile without allowing malformed state to prevent activation. */
export function activeConsoleProfileFromState(value: unknown): string {
  try {
    return typeof value === "string" ? normalizeConsoleProfile(value) : DEFAULT_CONSOLE_PROFILE;
  } catch {
    return DEFAULT_CONSOLE_PROFILE;
  }
}

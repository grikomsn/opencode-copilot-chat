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
  return `${credentialId}::${modelId}`;
}

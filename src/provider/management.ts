import { createHash } from "node:crypto";
import type { Credential } from "../auth/auth";

export interface ManagementCredentialOption {
  readonly credentialId: string;
  readonly label: string;
  readonly description: string;
}

export function apiKeyCredentialId(apiKey: string): string {
  return `key-${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

export function managementCredentialOptions(
  credentialIds: Iterable<string>,
  includeLegacy: boolean,
): readonly ManagementCredentialOption[] {
  const ids = new Set(credentialIds);
  if (includeLegacy) ids.add("legacy");
  return [...ids].sort().map((credentialId) => credentialId === "legacy"
    ? {
        credentialId,
        label: "Legacy command-managed credential",
        description: "Stored by the OpenCode sign-in command",
      }
    : {
        credentialId,
        label: `Native provider entry · ${credentialId.slice(4, 12)}`,
        description: "Stored by VS Code Manage Language Models",
      });
}

export function resolveManagementCredential(
  credentialId: string,
  nativeCredentials: ReadonlyMap<string, Credential>,
  legacyCredential: Credential | undefined,
): Credential | undefined {
  return credentialId === "legacy" ? legacyCredential : nativeCredentials.get(credentialId);
}

export const RELEASES_LATEST_API_URL = "https://api.github.com/repos/grikomsn/opencode-copilot-chat/releases/latest";

export interface ExtensionRelease {
  readonly tag: string;
  readonly version: string;
  readonly pageUrl: string;
  readonly vsixUrl: string;
}

export function parseExtensionRelease(value: unknown): ExtensionRelease | undefined {
  if (!isRecord(value) || typeof value.tag_name !== "string" || typeof value.html_url !== "string" || !Array.isArray(value.assets)) return undefined;
  const version = normalizedVersion(value.tag_name);
  if (!version || !isTrustedReleaseUrl(value.html_url)) return undefined;
  const asset = value.assets.find((candidate) => isRecord(candidate)
    && typeof candidate.name === "string"
    && candidate.name.endsWith(".vsix")
    && typeof candidate.browser_download_url === "string"
    && isTrustedReleaseUrl(candidate.browser_download_url));
  if (!isRecord(asset) || typeof asset.browser_download_url !== "string") return undefined;
  return { tag: value.tag_name, version, pageUrl: value.html_url, vsixUrl: asset.browser_download_url };
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = versionParts(candidate);
  const currentParts = versionParts(current);
  if (!candidateParts || !currentParts) return false;
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) return candidateParts[index] > currentParts[index];
  }
  return false;
}

function normalizedVersion(value: string): string | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined;
}

function versionParts(value: string): readonly [number, number, number] | undefined {
  const normalized = normalizedVersion(value);
  if (!normalized) return undefined;
  const parts = normalized.split(".").map(Number);
  return [parts[0], parts[1], parts[2]];
}

function isTrustedReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "github.com"
      && url.pathname.startsWith("/grikomsn/opencode-copilot-chat/releases/");
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

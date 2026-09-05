import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isNewerVersion, parseExtensionRelease } from "./releases";

describe("extension release updates", () => {
  it("parses a stable GitHub release with a VSIX asset", () => {
    assert.deepEqual(parseExtensionRelease({
      tag_name: "v0.4.9",
      html_url: "https://github.com/grikomsn/opencode-copilot-chat/releases/tag/v0.4.9",
      assets: [{
        name: "opencode-bridge-copilot-chat-0.4.9.vsix",
        browser_download_url: "https://github.com/grikomsn/opencode-copilot-chat/releases/download/v0.4.9/opencode-bridge-copilot-chat-0.4.9.vsix",
      }],
    }), {
      tag: "v0.4.9",
      version: "0.4.9",
      pageUrl: "https://github.com/grikomsn/opencode-copilot-chat/releases/tag/v0.4.9",
      vsixUrl: "https://github.com/grikomsn/opencode-copilot-chat/releases/download/v0.4.9/opencode-bridge-copilot-chat-0.4.9.vsix",
    });
  });

  it("rejects malformed releases, prereleases, missing assets, and untrusted URLs", () => {
    assert.equal(parseExtensionRelease(undefined), undefined);
    assert.equal(parseExtensionRelease({ tag_name: "v0.5.0-beta.1", html_url: "https://github.com/example", assets: [] }), undefined);
    assert.equal(parseExtensionRelease({ tag_name: "v0.5.0", html_url: "https://github.com/example", assets: [] }), undefined);
    assert.equal(parseExtensionRelease({
      tag_name: "v0.5.0",
      html_url: "https://example.com/releases/v0.5.0",
      assets: [{ name: "extension.vsix", browser_download_url: "https://example.com/extension.vsix" }],
    }), undefined);
    assert.equal(parseExtensionRelease({
      tag_name: "v0.5.0",
      html_url: "https://github.com/another/repository/releases/tag/v0.5.0",
      assets: [{ name: "extension.vsix", browser_download_url: "https://github.com/another/repository/releases/download/v0.5.0/extension.vsix" }],
    }), undefined);
  });

  it("compares stable semantic versions", () => {
    assert.equal(isNewerVersion("0.4.9", "0.4.8"), true);
    assert.equal(isNewerVersion("0.5.0", "0.4.9"), true);
    assert.equal(isNewerVersion("1.0.0", "0.99.99"), true);
    assert.equal(isNewerVersion("0.4.8", "0.4.8"), false);
    assert.equal(isNewerVersion("0.4.7", "0.4.8"), false);
    assert.equal(isNewerVersion("latest", "0.4.8"), false);
  });
});

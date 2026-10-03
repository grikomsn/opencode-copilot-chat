# Development

```sh
npm ci
npm run check
npm run package
```

The extension host is the right place to test authenticated inference. Unit tests use injected fetchers and fake Secret Storage; they never contact OpenCode with real credentials.

## Releases

User-visible changes use Changesets. The release workflow opens a version pull request; after it is merged, CI validates and packages the extension, publishes it to the Visual Studio Marketplace using the existing `VSCE_PAT` repository secret, and attaches the VSIX to a GitHub release.

The extension ID is `grikomsn.opencode-bridge-for-copilot-chat`; release assets use `opencode-bridge-for-copilot-chat-<version>.vsix`. `npm run release` validates and publishes locally when `VSCE_PAT` is available.

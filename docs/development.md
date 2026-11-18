# Development

```sh
npm ci
npm run check
npm run package
```

The extension host is the right place to test authenticated inference. Unit tests use injected fetchers and fake Secret Storage; they never contact OpenCode with real credentials.

## Shared kit

`src/kit/` is the [copilot-chat-kit](https://github.com/grikomsn/copilot-chat-kit)
git submodule shared by every Copilot Chat provider extension. It compiles and
tests with this repository (`npm test` runs its colocated tests too), so a fresh
clone needs `git clone --recurse-submodules` or `git submodule update --init`.

- Change shared behavior in the kit repository, push it, then run
  `git submodule update --remote src/kit` here and commit the bump.
- Keep provider quirks (auth, dialect extensions, cost tables, usage domains)
  in this repository; configure kit modules through their options instead of
  editing them in place.
- Dependabot proposes kit bumps weekly; CI checks out submodules.

## Releases

User-visible changes use Changesets. The release workflow opens a version pull request; after it is merged, CI validates and packages the extension, publishes it to the Visual Studio Marketplace using the existing `VSCE_PAT` repository secret, and attaches the VSIX to a GitHub release.

The extension ID is `grikomsn.opencode-bridge-for-copilot-chat`; release assets use `opencode-bridge-for-copilot-chat-<version>.vsix`. `npm run release` validates and publishes locally when `VSCE_PAT` is available.

## Native contract checks

After `npm run compile`, launch VS Code with this repository as the extension development path and `test/native/index.js` as the extension tests path. These checks use real VS Code response constructors with injected synthetic credentials and HTTP responses. They cover parallel calls, credential routing, and failure paths without accessing live accounts. Live chat and account checks remain separate.

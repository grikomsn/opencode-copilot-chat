<p align="center">
  <img src="https://raw.githubusercontent.com/grikomsn/opencode-copilot-chat/main/assets/cover.jpg" alt="OpenCode and GitHub Copilot" width="960">
</p>

<h1 align="center">OpenCode Bridge for Copilot Chat</h1>

<p align="center">Use OpenCode Console and OpenCode Go models directly from the GitHub Copilot Chat model picker in Visual Studio Code.</p>

<p align="center">
  <a href="https://github.com/grikomsn/opencode-copilot-chat/releases/latest"><img src="https://img.shields.io/github/v/release/grikomsn/opencode-copilot-chat?style=flat-square&logo=github&label=Release" alt="Latest GitHub release"></a>
  <a href="https://github.com/grikomsn/opencode-copilot-chat/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/grikomsn/opencode-copilot-chat/ci.yml?branch=main&style=flat-square&label=CI" alt="CI status"></a>
  <a href="https://github.com/grikomsn/opencode-copilot-chat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/grikomsn/opencode-copilot-chat?style=flat-square" alt="MIT license"></a>
</p>

This native VS Code `LanguageModelChatProvider` registers Console and Go as separate provider groups and streams their responses into Copilot Chat without a local proxy. VS Code 1.125 exposes the provider-entry configuration through the built-in Language Models UI; the packaged extension does not enable proposed APIs.

## Highlights

- Separate OpenCode Console and Go model groups
- Service-account API keys stay in each VS Code provider entry; the extension manages only device-code accounts in Secret Storage
- Named accounts that serve both Console and Go from one device session
- Credential-scoped live discovery, with six-hour persisted models.dev enrichment for Console and Go
- Streaming text, reasoning, image inputs, and agent-mode tool calls
- Thinking stays before the answer or tool calls, with parallel tool arguments and call IDs preserved across interleaved stream events.
- Model-specific Thinking Effort and Qwen thinking-budget controls
- Bounded gateway retries and context-aware token limits
- Provider-entry-scoped inference-token tracking and secret-safe diagnostics

## Quick start

1. Install [OpenCode Bridge for Copilot Chat](https://marketplace.visualstudio.com/items?itemName=grikomsn.opencode-bridge-for-copilot-chat) from the Visual Studio Marketplace. You need VS Code 1.125 or newer and GitHub Copilot Chat.
2. Alternatively, run `code --install-extension grikomsn.opencode-bridge-for-copilot-chat`. For manual installation, download the `.vsix` from the [latest GitHub release](https://github.com/grikomsn/opencode-copilot-chat/releases/latest) and run `code --install-extension ./opencode-bridge-for-copilot-chat-<version>.vsix --force`.
3. For Console or Go, open **Manage Language Models**, choose **Add Models**, select the provider, name the entry, and paste its service-account API key. Both Console and Go entries can instead reference an OpenCode account by profile ID: Console may use a device-code sign-in, and Go accepts either a device-code profile or an account-scoped Go key.
4. For device-code sign-in, run **OpenCode: Add Console Account**, choose a profile ID, then add a Console (or Go) entry in **Manage Language Models** with the same profile ID and no API key.
5. Optional: give key-only entries a stable **Entry Label** so their model IDs and usage scope survive key rotation.
6. Repeat any flow for another account or key — for example Console on a personal account and Go on a work subscription — then enable the models you want in Copilot Chat. **Review entries and accounts** in the Manage Connection menu keeps the two sides in step.

Marketplace installations receive updates through VS Code. Manual VSIX installations can be updated by installing the newest release asset.

### Moving from the previous extension

Version 1.0.0 starts a new listing with ID `grikomsn.opencode-bridge-for-copilot-chat`. Disable or uninstall `grikomsn.opencode-bridge-copilot-chat` before installing the new extension to avoid duplicate providers and commands. Sign in again or re-enter your API keys in the new extension; its Secret Storage and local usage state are separate. Existing `opencode.*` workspace settings retain their names.

Composer controls override workspace defaults; ordered effort controls default to High, binary controls default On, and Qwen defaults Auto. Console and Go use each entry's authenticated live catalog, while a Console device-code profile shows only models enabled for that profile's selected organization. Click the OpenCode status-bar item to inspect tokens for the most recently used entry.

## Documentation

- [Setup, commands, settings, and troubleshooting](https://github.com/grikomsn/opencode-copilot-chat/blob/main/docs/setup.md)
- [Models and pricing](https://github.com/grikomsn/opencode-copilot-chat/blob/main/docs/models.md)
- [Credential handling and security](https://github.com/grikomsn/opencode-copilot-chat/blob/main/docs/security.md)
- [Development and releases](https://github.com/grikomsn/opencode-copilot-chat/blob/main/docs/development.md)

## Related projects

- [Codex Bridge for Copilot Chat](https://github.com/grikomsn/openai-oauth-copilot-chat)
- [Grok for GitHub Copilot Chat](https://github.com/grikomsn/grok-copilot-chat)
- [Ollama Cloud for GitHub Copilot Chat](https://github.com/grikomsn/ollama-cloud-copilot-chat)
- [Poolside for GitHub Copilot Chat](https://github.com/grikomsn/poolside-copilot-chat)

Unofficial project; not affiliated with OpenCode, GitHub, or Microsoft. OpenCode account limits and charges still apply. Licensed under [MIT](LICENSE).

<p align="center">
  <img src="https://raw.githubusercontent.com/grikomsn/opencode-copilot-chat/main/assets/cover.jpg" alt="OpenCode and GitHub Copilot" width="960">
</p>

<h1 align="center">OpenCode for Copilot Chat</h1>

<p align="center">Use OpenCode Zen, OpenCode Go, and OpenCode Console models directly from the GitHub Copilot Chat model picker in Visual Studio Code.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=grikomsn.opencode-bridge-copilot-chat"><img src="https://img.shields.io/visual-studio-marketplace/v/grikomsn.opencode-bridge-copilot-chat?style=flat-square&logo=visualstudiocode&label=Marketplace" alt="Visual Studio Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=grikomsn.opencode-bridge-copilot-chat"><img src="https://img.shields.io/visual-studio-marketplace/i/grikomsn.opencode-bridge-copilot-chat?style=flat-square&label=Installs" alt="Visual Studio Marketplace installs"></a>
  <a href="https://github.com/grikomsn/opencode-copilot-chat/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/grikomsn/opencode-copilot-chat/ci.yml?branch=main&style=flat-square&label=CI" alt="CI status"></a>
  <a href="https://github.com/grikomsn/opencode-copilot-chat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/grikomsn/opencode-copilot-chat?style=flat-square" alt="MIT license"></a>
</p>

This native VS Code `LanguageModelChatProvider` registers Zen, Go, and Console as separate provider groups and streams their responses into Copilot Chat without a local proxy.

## Highlights

- Separate OpenCode Zen, Go, and Console model groups
- API-key and Console device-code authentication in VS Code Secret Storage
- Read-only, one-way import of an existing local Console session
- Credential-scoped live discovery with six-hour persisted models.dev enrichment
- Streaming text, reasoning, images, and agent-mode tool calls
- Model-specific Thinking Effort and Qwen thinking-budget controls
- Bounded gateway retries and context-aware token limits
- Shared status-bar token tracking and secret-safe diagnostics

## Quick start

1. Install [OpenCode for Copilot Chat](https://marketplace.visualstudio.com/items?itemName=grikomsn.opencode-bridge-copilot-chat). You need VS Code 1.125 or newer and GitHub Copilot Chat.
2. Run **OpenCode: Manage Connection**, choose Zen, Go, or Console, then enter an API key or complete Console sign-in.
3. Open Copilot Chat, select **Manage Models**, enable the connected OpenCode group, and choose a model.

Composer controls override workspace defaults; ordered effort controls default to High, binary controls default On, and Qwen defaults Auto. Zen and Go use their authenticated live catalogs, while Console shows only models enabled for the selected organization. Click the OpenCode status-bar item to inspect tokens across all three groups and manage the active connection.

## Documentation

- [Setup, commands, settings, and troubleshooting](https://github.com/grikomsn/opencode-copilot-chat/blob/main/docs/setup.md)
- [Credential handling and security](https://github.com/grikomsn/opencode-copilot-chat/blob/main/docs/security.md)
- [Development and releases](https://github.com/grikomsn/opencode-copilot-chat/blob/main/docs/development.md)

## Related projects

- [Codex Bridge for Copilot Chat](https://github.com/grikomsn/openai-oauth-copilot-chat)
- [Grok for GitHub Copilot Chat](https://github.com/grikomsn/grok-copilot-chat)
- [Ollama Cloud for GitHub Copilot Chat](https://github.com/grikomsn/ollama-cloud-copilot-chat)
- [Poolside for GitHub Copilot Chat](https://github.com/grikomsn/poolside-copilot-chat)

Unofficial project; not affiliated with OpenCode, GitHub, or Microsoft. OpenCode account limits and charges still apply. Licensed under [MIT](LICENSE).

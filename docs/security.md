# Security

## Credential storage

Zen and Go API keys added through **Manage Language Models** are marked as secret provider configuration, so VS Code stores every entry securely. The extension places only a short SHA-256-derived reference in model metadata and local usage state. The older command-managed Zen and Go defaults remain in Secret Storage for migration and development workflows.

Console access and refresh tokens are obtained only through an explicit device-code sign-in initiated in VS Code and stored per named profile in VS Code Secret Storage, with separate refresh locks and organization selection. The extension does not read credentials or sessions from OpenCode or other applications on the local machine.

The output channel records only status and metadata. It does not record API keys, access tokens, refresh tokens, prompts, response text, or account data.

## Network destinations

The extension sends requests directly to:

- The OpenCode gateway for model discovery, chat completions, tool calls, and usage
- `https://models.dev/api.json` for best-effort capability metadata only

There is no local proxy or project-operated relay. Prompts, tool definitions, and tool results selected by Copilot Chat are sent to the OpenCode gateway for inference.

## Inline completions

When `opencode.inlineSuggestions` is enabled, each suggestion request sends a bounded window of the current document (a fixed number of lines before the cursor and a bounded suffix after it) plus the stored Zen or Go API key to the OpenCode gateway's chat-completions endpoint. Upstream error bodies are never surfaced or logged because they can echo prompt context. Suggestion text flows only into the editor's ghost text; document context, prompts, and keys are never written to logs or storage. The feature is disabled by default and can be turned off at any time.

## Logging

The extension logs request and stream metadata, model discovery, and error summaries. It never intentionally logs API keys, access tokens, refresh tokens, prompts, response text, or account data.

## Reporting vulnerabilities

Report vulnerabilities according to the [security policy](https://github.com/grikomsn/opencode-copilot-chat/security/policy) or email [security@nibras.co](mailto:security@nibras.co). Do not disclose credentials, sensitive prompts, or vulnerability details in a public issue.

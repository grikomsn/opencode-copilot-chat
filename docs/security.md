# Credential handling

Service-account API keys are entered by the user in **Manage Language Models** and marked as secret provider configuration, so VS Code stores every entry and the extension never reads, copies, or persists keys. The extension places only a short SHA-256-derived reference in model metadata and local usage state.

The extension manages only OpenCode Console device-code accounts. Access and refresh tokens are obtained exclusively through an explicit device-code sign-in initiated in VS Code and stored per named account (profile) in VS Code Secret Storage, with separate refresh locks and organization selection. One session token authenticates both the Console and Go gateways. The extension does not read credentials or sessions from OpenCode or other applications on the local machine.

The output channel records only status and metadata. It does not record API keys, access tokens, refresh tokens, prompts, response text, or account data.

## Inline completions

When `opencode.inlineSuggestions` is enabled, each suggestion request sends a bounded window of the current document (a fixed number of lines before the cursor and a bounded suffix after it) plus the stored Console or Go API key to the OpenCode gateway's chat-completions endpoint. Upstream error bodies are never surfaced or logged because they can echo prompt context. Suggestion text flows only into the editor's ghost text; document context, prompts, and keys are never written to logs or storage. The feature is disabled by default and can be turned off at any time.

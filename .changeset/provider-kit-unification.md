---
"opencode-bridge-for-copilot-chat": patch
---

Fix repeated tool names and harden request encoding

- Gateways that resend the full function name on every streamed delta no longer produce concatenated tool names.
- History conversion drops empty turns, starts with a user turn, forwards tool-result images to the model, and no longer sends lone UTF-16 surrogates.
- API-key fingerprints ignore surrounding whitespace, retries share one total deadline, and the picker shows cached-input prices.

Shared provider plumbing now comes from the copilot-chat-kit submodule, so fixes land in every Copilot Chat provider extension at once.

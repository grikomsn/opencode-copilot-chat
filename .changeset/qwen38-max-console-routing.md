---
"opencode-bridge-for-copilot-chat": patch
---

Route npm-less `qwen3.8-max` requests on the zen/consumer gateway to its
documented (and live-verified) chat-completions endpoint. The gateway now
rejects `qwen3.8-max` on `/messages` with a `ModelProtocolUnsupported`
error; the Go gateway keeps the messages shape.

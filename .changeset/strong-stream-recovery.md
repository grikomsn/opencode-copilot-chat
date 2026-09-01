---
"opencode-bridge-copilot-chat": patch
---

Harden streamed responses by recovering final Responses text, rejecting incomplete tool arguments, retrying transient network failures, and allowing bounded multi-parameter compatibility retries.

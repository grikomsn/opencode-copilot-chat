---
"opencode-bridge-for-copilot-chat": patch
---

Fail chat responses with an explicit error when the upstream stream ends without
a completion reason, is cut off by the model's output token limit or content
filter, or stalls past the request/stream idle timeout, instead of stopping
mid-inference silently. Responses-stream parallel tool calls now flush
individually as each completes, a completed message item no longer flushes
in-flight sibling tool calls, and chat tool deltas without an index no longer
fragment into malformed calls.

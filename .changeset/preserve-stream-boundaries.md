---
"opencode-bridge-for-copilot-chat": patch
---

Preserve thinking before answers and parallel tool calls, and explicitly close thinking when visible output or stream completion begins. Keep Responses item IDs, call IDs, and output indexes linked so interleaved arguments reach the correct tool. Preserve chat calls when a gateway alternates indexed and ID-only deltas.

Parse the final SSE block before validating completion, and generate distinct fallback IDs for simultaneous tool calls and Google calls arriving in separate stream events.

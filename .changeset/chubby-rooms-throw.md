---
"opencode-bridge-copilot-chat": patch
---

Fix Auto context size being interpreted as zero input tokens by VS Code, collapsing the context indicator to the output reserve and triggering premature compaction.

Keep tool results adjacent to their calls instead of inserting an empty user message, fixing strict upstream tool-loop validation.

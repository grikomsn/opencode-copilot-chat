---
"opencode-bridge-copilot-chat": patch
---

Resync OpenCode Zen and Go model routing with the updated model catalog: route Go MiniMax M3 and Qwen3.8/3.7 tiers through the native Messages dialect, default Grok 4/Build and Muse Spark families to the Responses gateway when discovery metadata is unavailable, and enrich discovery-only models (currently Hy3 preview) with sibling metadata until models.dev catalogs them.
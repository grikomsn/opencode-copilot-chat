---
"opencode-bridge-copilot-chat": patch
---

Mirror canonical upstream metadata for discovery-only Go models before models.dev catalogs them: `deepseek-flash` (DeepSeek V4.1 Flash with limits, image input, reasoning efforts, and published costs), plus the anonymous-discovery ids `minimax-m2.5`, `kimi-k2.5`, `glm-5.1`, `glm-5`, and `qwen3.5-plus`. Also filter internal OpenCode smoke-test ids (`test*`) that leak into authenticated Zen discovery, instead of listing them as unenriched picker entries.
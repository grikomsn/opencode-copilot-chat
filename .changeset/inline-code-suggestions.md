---
"opencode-bridge-copilot-chat": minor
---

Add experimental, opt-in inline code suggestions (ghost text) powered by the OpenCode gateway with thinking forced off. Enable with `opencode.inlineSuggestions`, choose the gateway (`inlineSuggestionsGateway`, default `go`) and model (`inlineSuggestionsModel`, default `qwen3.7-plus`), and tune debounce, timeout, token budget, and context windows. A new **OpenCode: Set Inline Suggestions Model** command (also in the Manage menu) lists compatible models ordered cheap-and-fast first with measured badges, and can switch the gateway when a Zen-only model is picked; a custom model id remains enterable. Measured on the live gateway: `qwen3.7-plus` (Go) and `qwen3.6-plus` (Zen) complete fill-in-the-middle prompts with zero hidden reasoning. Suggestions never appear in the Copilot Chat prompt box unless separately enabled, and document context is never logged.

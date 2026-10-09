---
"opencode-bridge-for-copilot-chat": patch
---

Align thinking controls with live-verified gateway behavior (probed 2026-10-09)

- GLM 5.1/5.2/5.3 are thinking-only on both gateways: `reasoning_effort: "none"` and `thinking: {type: "disabled"}` are rejected, so Off now maps to the lowest accepted effort (`low`) and the effort picker offers `off/low/high/max`
- MiniMax M3 accepts `thinking: {type: "disabled"}` when off (both gateways); `enabled` stays omitted from the M3 payload since the Go gateway rejects it (adaptive/disabled only)
- MiMo models accept only `low/high` efforts — `medium` was removed from the picker (rejected upstream)
- Supplemental mirrors updated from live probes: glm-5.1/glm-5 and mimo-v2-pro/mimo-v2-omni gain verified effort lists, omen-alpha and hy3-preview gain `max`, and hy3-preview's shape now matches its accepted toggle+effort set

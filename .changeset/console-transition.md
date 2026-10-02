---
"opencode-bridge-copilot-chat": minor
---

Transition OpenCode Zen into OpenCode Console, matching upstream's consolidation of the Zen gateway into the Console.

- The `opencodezen` provider group is removed; former Zen entries now live in the OpenCode Console group against the same `https://opencode.ai/zen/v1` gateway. Console and Go both accept a service-account API key and the Console device-code flow, mirroring upstream's two sign-in methods. Stored Zen API keys, `opencode.defaultMode` values, inline-suggestion gateway values, and usage history migrate automatically.
- Console model catalogs: service-account keys load the shared public `/models` catalog with free-only filtering, while device-code profiles keep the organization-scoped `/api/config` discovery.
- Refreshed live model catalogs with new Console models (`jev-1.13`, `jev-1.13-free`, `fledge-alpha-free`) and new Go models (`deepseek-v4-pro`, `mimo-v2.6-flash`, `mimo-v2.6-pro`, `gpt-6-luna`, `grok-4.7`, `qwen3.8-max/flash`), with supplemental metadata for discovery-only ids not yet in models.dev.

# Models and pricing

## Live metadata

The extension discovers the catalog available to each configured provider entry
from that gateway's live `models` endpoint: `https://opencode.ai/zen/v1/models`
for Zen and `https://opencode.ai/zen/go/v1/models` for Go. Live responses
provide names, context windows, maximum output lengths, reasoning support and
effort options, image input, and tool-calling support used by Copilot Chat.
Zen free-tier entries can be filtered to cost-free models only.

Console entries skip public discovery: models come from the selected
organization's configuration on the Console server and never show public or
other-organization models.

Fields the live responses omit are enriched from the canonical `opencode` and
`opencode-go` providers in a six-hour models.dev snapshot
(`https://models.dev/api.json`) stored in VS Code `globalState`. Stale metadata
is returned immediately while refresh runs and remains available during
models.dev outages. Models served by discovery before models.dev catalogs them
use a small supplemental entry — currently `hy3-preview` on the Go gateway —
which is superseded by the canonical upstream entry once it lands.

Successful Zen and Go catalog results are cached per entry (mode, free-only
scope, and a fingerprint of the credential) for up to 24 hours in
`globalState`. When discovery fails or no key is configured, the extension
falls back to the cached catalog and then to a bundled snapshot:

| Gateway | Model | Context |
| --- | --- | ---: |
| Zen | DeepSeek V4 Flash Free | 200K |
| Zen | Nemotron 3 Ultra Free | 1M |
| Zen | Big Pickle | 200K |
| Zen | Kimi K2.5 | 256K |
| Go | Kimi K2.6 | 256K |
| Go | DeepSeek V4 Flash | 1M |
| Go | MiniMax-M3 | 1M |
| Go | Qwen3.7 Plus | 1M |
| Go | GLM-5.3 | 1M |
| Go | Kimi K3 | 1M |

Live catalog results remain authoritative when they differ from this snapshot.

## Pricing

The model picker displays each model's input, cached-input, and output pricing
when the live catalog or models.dev metadata reports a cost. Models with a
`-free` suffix plus `big-pickle` are shown as Free. When no discovered pricing
is available, the extension falls back to the official rates below
(USD per 1M tokens):

| Model | Input | Cached input | Output |
| --- | ---: | ---: | ---: |
| Kimi K2.6 | $0.95 | $0.16 | $4.00 |
| DeepSeek V4 Flash | $0.22 | $0.007 | $0.66 |
| MiniMax-M3 | $0.30 | $0.06 | $1.20 |
| Qwen3.7 Plus | $0.40 | $0.04 | $1.60 |

Prices never override the discovered catalog values; they only fill gaps.

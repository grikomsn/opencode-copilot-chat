/**
 * Vetted inline-completion model candidates, ordered cheap-and-fast first.
 *
 * Badges carry the live-measured (2026-09-06) latency and hidden-reasoning
 * results; unmeasured compatible models are listed after the measured ones and
 * marked as such. The QuickPick command renders this list and writes the
 * selected id to `opencode.inlineSuggestionsModel` (and, when needed, the
 * matching gateway), so choices need no reload. Unknown model ids stay
 * reachable through the command's custom entry and the raw setting.
 *
 * Pure and unit-tested.
 */

import type { InlineGateway } from "./config";

export interface InlineModelCandidate {
  readonly id: string;
  /** Short measured/compatibility badge, e.g. "★ recommended · measured 1.4s". */
  readonly badge: string;
  /** One-line rationale shown under the model id. */
  readonly detail: string;
}

const GO_CANDIDATES: readonly InlineModelCandidate[] = [
  {
    id: "qwen3.7-plus",
    badge: "★ recommended · measured 1.4s TTFB",
    detail: "Zero hidden reasoning with enable_thinking: false; Go standard usage tier is the cheapest path.",
  },
  {
    id: "mimo-v2.5",
    badge: "measured 1.4s TTFB",
    detail: "Zero hidden reasoning with thinking disabled; correct completion at default speed.",
  },
  {
    id: "kimi-k2.6",
    badge: "measured 1.6s TTFB",
    detail: "Zero hidden reasoning with thinking disabled; slightly slower than the default.",
  },
  {
    id: "hy3",
    badge: "measured 2.0s TTFB",
    detail: "Advertised reasoning_effort none; cleanest zero-reasoning result but slower than Qwen.",
  },
  {
    id: "qwen3.7-max",
    badge: "⚠ measured: wrong scaling",
    detail: "Divides by max only instead of min-max; not recommended for ghost text.",
  },
  {
    id: "qwen3.8-flash",
    badge: "⚠ measured: wrong scaling",
    detail: "Hardcoded constants instead of min-max normalization; not recommended.",
  },
  {
    id: "kimi-k3",
    badge: "⚠ measured: thinking persists",
    detail: "Burned 500 hidden reasoning characters with thinking disabled; not recommended.",
  },
  {
    id: "minimax-m2.7",
    badge: "⚠ measured: request fails",
    detail: "Upstream returned an internal server error with thinking disabled.",
  },
  {
    id: "glm-5.1",
    badge: "⚠ thinking-only upstream",
    detail: "Gateway upstream rejects the disable field (GLM is served thinking-only); cannot run without reasoning.",
  },
  {
    id: "glm-5.2",
    badge: "⚠ thinking-only upstream",
    detail: "Same upstream rejection as glm-5.1; cannot run without reasoning.",
  },
];

const ZEN_CANDIDATES: readonly InlineModelCandidate[] = [
  {
    id: "qwen3.6-plus",
    badge: "★ recommended · measured 1.4s TTFB",
    detail: "Zero hidden reasoning with enable_thinking: false; pay-as-you-go Zen balance required.",
  },
  {
    id: "kimi-k2.5",
    badge: "measured 1.2s TTFB",
    detail: "Zero hidden reasoning with thinking disabled; measured faster than the default on Zen.",
  },
  {
    id: "qwen3.5-plus",
    badge: "measured 1.8s TTFB",
    detail: "The original fork default; zero hidden reasoning, pay-as-you-go Zen balance required.",
  },
  {
    id: "glm-5.2",
    badge: "⚠ thinking-only upstream",
    detail: "Gateway upstream rejects the disable field (GLM is served thinking-only); cannot run without reasoning.",
  },
];

export const INLINE_MODEL_CANDIDATES: Readonly<Record<InlineGateway, readonly InlineModelCandidate[]>> = {
  go: GO_CANDIDATES,
  zen: ZEN_CANDIDATES,
};

export interface InlineModelChoice {
  readonly id: string;
  readonly gateway: InlineGateway;
  readonly label: string;
  readonly description: string;
  readonly detail: string;
}

/** Build QuickPick-shaped choices, pinning an unlisted current id to the top. */
export function inlineModelChoicesForGateway(gateway: InlineGateway, currentId: string): InlineModelChoice[] {
  const candidates = INLINE_MODEL_CANDIDATES[gateway];
  const listed = candidates.map((candidate) => ({
    id: candidate.id,
    gateway,
    label: candidate.id === currentId ? `$(check) ${candidate.id}` : candidate.id,
    description: candidate.badge,
    detail: candidate.detail,
  }));
  const pinned = !candidates.some((candidate) => candidate.id === currentId)
    ? [{
      id: currentId,
      gateway,
      label: `$(check) ${currentId}`,
      description: "current value",
      detail: "Kept from your settings; not in the vetted list.",
    }]
    : [];
  return [...pinned, ...listed];
}

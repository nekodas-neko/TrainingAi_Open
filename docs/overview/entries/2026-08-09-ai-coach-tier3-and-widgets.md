# 2026-08-09 — AI Coach Phase 3b: the tier-3 screen and the last widgets

**Branch:** `claude/health-metrics-button-designs-hy6cyv` · **Q-157 phase 3, part 2 of 2 —
the feature is complete** · **v1.273.0**

## What shipped

- **`program_phase`** — the fifth and last write domain, and the only tier-3 one.
- **`/coach/confirm/[toolCallId]`** — a pushed full screen with **hold-to-confirm**, the one
  destructive-coloured control in the feature. Tier 1–2 still confirm inline.
- **`Handoff`** and **`NumberDial`** widgets, with their tools.
- The **chart-pairing rule** in the system prompt: 2–6 items get a chart plus a colour-keyed choice
  list that doubles as its legend; more than six skip the chart.

## Why tier 3 is a different screen

Not because it writes more rows — because it is the only domain whose effects **take something
away**. Cycles completed are derived from `logged sessions ÷ sessionsPerCycle`, so changing the
cycle length moves where you are in the block, and can move you backwards past work you have
already done. The consequence is computed and stated exactly: *"Moves you back from cycle 4 to
cycle 2 — you lose 2 cycles of progress toward your next deload."*

`DOMAIN_TIER` in `patch.ts` is what routes it. A tier-3 proposal renders an in-thread stub with no
toggle and no Apply — its only job is to get you to the screen.

## How the patch reaches the pushed screen

`sessionStorage`, keyed by the tool call's id (`lib/coach/pending-change.ts`). A URL cannot carry an
object, and a patch in a query string is a patch anyone can edit. Three consequences, all stated in
that file: a reload loses it (and the screen says the proposal expired rather than applying
something the user cannot see the origin of), it is per-tab, and it is **never the authority** —
`/api/coach/apply` re-validates against current state exactly as it does inline.

## A correction to the Phase 2 record

The Phase 2 journal and the backlog both said `/api/ai-chat/route.ts` was unreferenced and could be
deleted. **That was wrong, and deleting it would have broken a live page.** `app/chat/page.tsx`
renders `components/chat.tsx`, which posts to it; `app/sheet/[id]/chat` redirects there. The Phase 2
check looked for imports of `ai-chat-overlay`, not callers of the route. Caught here because the
deletion was verified rather than assumed — restored, and both documents corrected.

## Also found

**A backtick inside the backtick-delimited system prompt** terminated the template literal and
failed `next build` with `Expected a semicolon`. Same class as the Phase 1 route-export lesson: for
route changes, a type-check is not a substitute for a build.

## Verification

Signed in against the dev server at 412×891:

| Check | Result |
|---|---|
| Full suite | 3345 tests green |
| `pnpm build` | compiles; `/coach/confirm/[toolCallId]` emitted at 6.02 kB |
| Lint + all 13 custom-rules scripts | pass |
| "change my sessions per cycle to 5" | in-thread stub → pushed screen |
| The consequence | "Moves you back from cycle 4 to cycle 2 — you lose 2 cycles", computed from 9 real logged sessions |
| **300 ms tap on Hold to apply** | **nothing written** — still 3 |
| **1600 ms hold** | written — 5, and back to `/coach` |
| Drift / undo / cross-domain | 4 new DB-backed tests |

**Not verified on device.** The existing AI Coach Known-Issues row covers it, and the confirm screen
adds a second navless full-screen surface with a bottom-anchored action row — the same shape as the
composer, and the same reason it cannot be checked here. Its checklist line is in
`docs/device-smoke-checklist.md`.

## Q-157 is complete

Five write domains, eight widgets, three tiers of confirmation, history and undo. What is left is
not this feature: `docs/implementation-backlog.md` carries the follow-ups (cardio goals were dropped
from scope — see the entry).

# LB-117 — the explain page said a muscle was sore beside a score that ignored it

**Branch:** `fix/lb117-explain-sore-provenance` · **Version:** 1.483.1

After BF-173, an accepted *suggestion* is listed as sore and does **not** lower the session score,
while a tick the lifter added does. The explain page showed both on one "Sore muscles" line, so it
could present a muscle as sore next to a recovery figure that had ignored it — the reads-as-broken
shape Q-105 exists to prevent, on the one page whose rule is to show the numbers the recommendation
was actually computed from.

## It was parked, and the block is genuinely gone

The entry carried `Needs: LB-118` and said plainly that it was *"NOT buildable in this lane yet"*.
Verified against the code rather than the queue: `adapter.ts` now returns
`signals.suggestedSoreMuscles` with LB-118's own comment, `NextSessionRecommendation['signals']`
carries the field, and `buildSessionExplainData` passes `signals` straight through. So the value is
already on the client — only the explain types and copy were missing it.

## What shipped

`soreRows(sore, suggested)` in `group-signals.ts` splits one row into two:

| | value | chip |
|---|---|---|
| **Sore muscles** | the lifter's own ticks | `lowered the score` (amber) |
| **Also sore** | the ones the app suggested | `already counted` (green) |

With every tick a suggestion there is no first row to be "also" to, so it keeps the primary label.
A suggestion the lifter later unticked never renders — `suggested` is what the app proposed, not
what survived.

**`suggested == null` falls back to today's single unchipped line.** That is the case worth stating:
the check-in predates provenance, and BF-173's rule is that absent means *unknown* and is scored the
old way. Reading it as "none were suggestions" would claim every tick lowered the score — a guess
dressed as an explanation, which is precisely what this page must not do.

## Lane note

`packages/shared/src/session-explain/**` is on Lane A's path list, but the lane **rule** — which
CLAUDE.md says is the authority over those lists — puts it in Lane B: nothing under `app/api/**`
imports it, and the explain data is built client-side in `app/session-explain/`. Claimed here and
recorded in the baton.

## Verified

- `packages/shared/src/session-explain/__tests__/lb117-sore-provenance.test.ts` — **6 tests**,
  including the null fallback for both `null` and `undefined`, the all-suggested case keeping the
  primary label, and an unticked suggestion not rendering.
- `e2e/lb117-explain-sore-provenance.spec.ts` — **2 tests** at 412 px dark against the real page,
  recommendation injected (`buildSessionExplainData` returns null without a scored ai_dynamic
  session, so every assertion would otherwise pass vacuously against the empty state). The signals
  area is collapsed by default, so each test opens it — which is what the first run found.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **956 files, 9,514 passed** · `pnpm build`. Screenshotted.

## Not exercised

- **Which muscle sits under which chip, through the DOM.** The value and its chip share one span, so
  a DOM assertion on the pairing is brittle; the six unit tests own that and the e2e proves the rows
  reach the screen. Stated in the spec's docstring rather than left implicit.
- **A real check-in.** The seeded user has no sore tick with recorded provenance, so this has only
  been drawn against an injected recommendation.
- **The device.** No native, safe-area or gesture change.

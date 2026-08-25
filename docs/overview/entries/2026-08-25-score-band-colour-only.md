# 2026-08-25 — the colour-only score, and the three entries the queue was handing to the wrong lane

**Branch:** `fix/score-band-colour-only` · **Lane B** · one component line, three backlog lane
fields. No schema, no route.

## Q-281's cheapest subset — one site, not a sweep

Q-281 asks for an audit of every surface rendering a bare score, and names its own cheapest first
pass: the ones failing the colour-only-state rule, *"since `scoreBand()` colour without
`scoreBand()` label is already a `CLAUDE.md` violation"*.

All nine non-test `scoreBand()` call sites were **read**, not counted. Exactly one is a violator:

- **`readiness-breakdown.tsx:72`** — the **"Final readiness"** row colours the score by band and
  shows no band word, in the branch that renders no legend either. A bare amber `62` says nothing to
  anyone who cannot see amber. The label ships beside it now.

**The other eight are fine, and a grep says otherwise — which is the point.**
`contributor-chart.tsx` contains no `.label` anywhere and would top any "colour without label" grep;
it renders `<ScoreBandLegend />`, which pairs every colour with its meaning, and is correct.
`score-ring`, `alternatives-card`, `contributor-detail`, `contributor-details`,
`health-score-detail` and `oura-score-chip-row` all render the word already.
`app/api/ai/health-insight` uses only `.label` and never the colour.

**This is the Q-491 lesson arriving again**: that entry claimed nine `aria-expanded` violators and
had two, because a chevron grep cannot see a Radix trigger. A zero-label grep count is not a
violator list either. Reading nine files cost minutes and removed eight false positives.

## Three entries the tool was serving to the wrong lane

`next-item.js` shows an entry with **no `Lane:` field to both lanes**, by design — the path rule is
supposed to answer it. For these three the path rule answers *Lane A*, and nothing said so, so they
sat at the top of Lane B's queue:

- **Q-289** and **Q-290** — `expectedRpe`, `autoregulation.ts` and `RPE_DEAD_BAND` all live in
  `packages/shared/src/ai-periodization/`. **And both are scoring changes**, so the route is not an
  implementer's at all: Tuning proposes, the owner signs off, Lane A implements. A proposal is
  incomplete until it states how many other days the change moves.
- **Q-291** — the contradiction is between AI route outputs (`app/api/ai/**`, `lib/coach/**`).

Lane B's READY went **59 → 56**. Only these three were touched: a bulk lane sweep is Orchestrator's
work, not an implementer's, and there is a visible run of unlaned `readiness`/`platform` entries
below them that wants exactly that sweep.

## Verified

- `tsc --noEmit` clean · eslint clean · `pnpm check:rules` **Ran 56 of 56** ·
  `check-backlog-pointers` OK at 193 entries.
- `next-item.js` re-run for both lanes: the three entries move to Lane A's list and off Lane B's.

## Not exercised

- **The amended row was not rendered.** It is a one-line label addition in a branch that needs a
  readiness score with an `ouraScore` present, which the local seed has no row for. The change is a
  literal from `scoreBand()`, which is unit-tested where it lives — but the row itself has not been
  looked at, at any width. `Gate: device`.
- **Q-281's actual survey is untouched** — contributors / trend / action per surface. Only the
  colour-only subset it named as the cheapest first pass is done, and the larger presentation
  question (overlapping Q-278 and Q-305's "computed and discarded" thread) is still open.

# 2026-08-26 — Readiness contributors record the input they were scored from (Q-501)

**Lane A · branch `fix/readiness-contributor-inputs` · v1.383.6**

## What was wrong

A persisted readiness contributor was `{score, provisional}` and nothing else. So the only way to ask
"what produced this 58?" was to read today's `oura_daily_summary` and assume it had not been
recomputed since — and it often had. Summaries get re-rolled and the derived rows built from them are
not recomputed in step, so the admin day-review paired a **stored** score with **today's** raw inputs
and called them "the inputs that produced it". On a drifted day that pairing is simply false, and
nothing on the panel said which of the two had moved.

That mattered beyond the panel: a stored score disagreeing with a fresh recompute has two causes
needing opposite responses — the inputs were rewritten (a data question) or the model moved (a
calibration question) — and neither was distinguishable from the row.

## Premise re-measured first, and it was wrong

The entry claimed **5 of 33** stored recovery-index contributors disagreed with the summary they
derive from. Measured against production before building anything:

| population | n |
|---|---|
| derived rows | 100 |
| carrying a `recoveryIndex` contributor | **42** |
| match the current anchor (5 h) | 9 |
| match the previous anchor (6 h) | **27** |
| match neither — genuinely un-re-derivable | **7** |

So the original figure conflated *an older model* with *genuine drift*. 27 of the "disagreements" are
a previous anchor doing exactly what Q-273's version stamp exists to record. The un-re-derivable
population is **7**, and those are the rows no model applied to the stored hours reproduces.

## What shipped

The entry's own "First action" offered two options — recompute derived rows with their summary, or
store the inputs they actually used. The second was taken: it is cheaper, self-describing, and does
not silently re-score history.

- `ReadinessContributor` gains `input: number | null` — the number the score was computed **from**: a
  z-score for the four baseline-relative terms, a 0-100 value for the pass-throughs, raw hours for the
  Recovery Index. It is `null` when the contributor fell back to neutral, **including when a z existed
  but the baseline was cold** — recording the z there would make the row look re-derivable when the
  score was never a function of it.
- `rederiveReadinessFromStored(stored)` asks a persisted row whether its own score follows from its
  own inputs, returning the drifted contributors, the ones with no stored input, and the composite the
  current model gives for those inputs.
- The readiness audit uses it to emit one of three notes — **MODEL moved**, **INPUT change**, or
  *these contributors carry no inputs and cannot be checked*. The admin panel already renders
  `notes`, so this surfaces with no UI change.

**No score moves.** `input` sits beside the score and never participates in it. The four existing
shape assertions that broke were `toEqual` checks whose diff showed one added key and an unchanged
`score` — which is itself the proof.

**No migration.** `readiness_contributors` is JSONB on Postgres and TEXT JSON in the local store; the
field rides in the object that was already being persisted.

## Verification

- Full suite green; `pnpm check:rules` **Ran 59 of 59**; `tsc --noEmit` clean; lint clean.
- **Nine mutations, each with an asserted anchor**, all caught after two rounds. Two survived the
  first pass and both were real coverage gaps, now closed:
  - a pass-through storing `Math.round(input)` — re-derives to the same score, so nothing noticed,
    while reporting an input the day never had. Pinned with a fractional input.
  - the "INPUT change" note firing alongside "MODEL moved" — two contradictory verdicts, which leaves
    the reader exactly where this finding found them. Pinned by asserting their exclusivity.

## Not exercised

Samsung WebView rendering of the new notes (they are plain text in an existing list), and the
production backfill described below.

## What is still owed

The ~100 rows written before this shipped carry no inputs and can never be checked retroactively. The
audit names them `uncheckable` rather than passing them silently — the honest reading, not a fix.
Refreshing them means running `POST /api/admin/backfill-derived-scores` against production, which
**rewrites stored scores**: an owner call, not code work. Q-501 stays in the queue carrying only that.

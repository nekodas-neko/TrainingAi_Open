# 2026-09-22 — TN-58: ask whether today is better or worse than yesterday

**Branch:** `feat/tn58-vs-yesterday-control` · **Lane:** Implementation B · **Version:** 1.465.0

## What shipped

The absolute "perceived recovery" 1–5 produced **two distinct values across 96 check-ins**, sd 0.29,
and **not one of them was touched**. A question with no variance cannot be a target for anything,
which is what blocks TN-33. People order two things more reliably than they score one, so the sheet
now asks for the comparison: **better / about the same / worse than yesterday**, three taps.

`components/checkin/vs-yesterday-picker.tsx` is new; `morning-checkin-sheet.tsx` holds the state,
restores a saved answer, and posts `vsYesterday` straight through. LB-124 had shipped the column,
the Zod schema, both write paths and the local store, and left `vsYesterday: null` in the sheet's
local write with a comment pointing at this entry — that placeholder is gone, because with the real
value in the payload spread beside it, key order would have decided silently which won.

**No default and no pre-selection.** The column has no default for the same reason: a neutral stored
as though it were an answer is precisely the defect TN-57 fixed, and shipping one on the question
written to escape it would recreate it under a new name. There is no `touched` flag either — unlike
the 1–5 scales there is no seeded position for an untouched save to accept, so NULL already carries
"not answered". Tapping the selection again clears it, so a mis-tap returns to unanswered.

It sits **above** the two scales. It is the question this check-in actually wants answered, and one
placed below two the owner has skipped for 81 days inherits their fate.

## The decision the entry left ambiguous

TN-58 says *"replace the absolute scale with a comparative one"* in its proposal and *"keep
`perceived_recovery` as-is and add the comparative field beside it"* in its warnings. **Added, not
replaced** — three reasons: the entry's own scope line says the control "and nothing else";
`perceivedRecovery` feeds `signals.morningCheckin` and shapes the prescription, so retiring its
control silently changes what the engine receives, which is Lane A's surface; and `sleepQualityFeel`
is a different question untouched by the finding. **Retiring the absolute control is a separate
entry conditional on the pass test**, to be filed with the measurement in hand rather than now.

## What is owed, and why it is a `Keep:` rather than a tick

**The two-week pass test cannot be run for a fortnight.** `vs_yesterday` must show **≥3 distinct
values and a touched-rate materially above zero**; the baseline to beat is 2 values in 81 days.
**If it fails, that is the finding, not a defect** — self-report is not available from this owner at
all, which settles TN-33/TN-16/TN-34/TN-55 by a different route. The backlog carries this as TN-58's
`Keep:`, with an explicit "do not quietly re-tune the control and restart the clock".

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean; lint clean.
- **Unit: 2 of 5 cases discriminate**, stated in the header. Three characterise a component that did
  not exist and Lane A's schema — they pass either way and are there because the design depends on
  them: a 201-that-stores-nothing, or a three-tap check-in rejected as empty, would each stop this
  question producing the variance it exists for.
- **e2e `tn58-vs-yesterday-no-default.spec.ts`** drives the real sheet at 412px and asserts all three
  options open `aria-checked="false"`, that selecting one excludes the others, and that re-tapping
  clears it. It **deliberately does not call `suppressMorningCheckin`** — every other spec suppresses
  this sheet and this one needs it open.

**Not exercised:** no device sitting. The sheet is a daily native surface and this changes what it
asks, so the S25 pass is worth having before the fortnight's clock is trusted.

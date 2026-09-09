# 2026-09-09 — the admin reports, and a Q-548 defect two of them were carrying (PS-39, 34 → 30)

**Branch:** `test/admin-report-routes` · **Product change**, version 1.441.3.

13 cases over `admin/errors`, `admin/ai-usage`, `admin/pending-count` and `admin/time-audit`.

## The defect

`admin/errors` and `admin/pending-count` wrapped **both** the admin check and the repository read in
a bare `catch` returning 403. That is exactly the shape `adminErrorResponse` was written to prevent,
and its own doc comment names it: `requireAdmin` makes a database round-trip, so a bare catch turns
an outage into `Forbidden` — the one status a caller will neither retry nor escalate.

**On the error-log viewer it is at its worst.** That screen is what you open *during* an outage, and
it was answering "you lack permission", pointing the investigation at credentials. The same
misreading cost several minutes on 2026-08-18 while the Railway dashboard already said the service
was offline.

Both now use `adminErrorResponse` (403 for a genuine refusal, 503 for a check that could not run),
as `ai-usage` and `time-audit` already did — so this is bringing two stragglers onto the existing
pattern rather than inventing one. The repository read moves **outside** the try as well, so a
failed query surfaces as the fault it is and reaches `error_events`, instead of being flattened into
a permissions answer.

## What else the cases decide

- **`ai-usage` refuses an out-of-range window; `time-audit` clamps its day count.** The disagreement
  is deliberate — one is a hand-typed query where a silently-clamped ten-year window would answer a
  different question and look like a real reading; the other comes from a UI control and echoes back
  the value it actually used. Both are pinned, and a case notes the difference so a reader comparing
  the neighbours finds it stated rather than inferred.
- `time-audit` rounds rather than truncates, caps the session list at 30, and scopes to the caller.
- `pending-count` reports two counts with **different** numbers in the fixture — equal ones would let
  the two reads be swapped and the response still look right.

## Two assumptions of mine that were wrong

`?unknown=1` does **not** 400 on `ai-usage`: the route builds its parsed object from three named
parameters, so `.strict()` never sees an extra key. And a fixture of bare `{id, startedAt}` session
objects decomposes to an empty list, because `decomposeSessions` drops anything without a
`completedAt` or shorter than 120 seconds — so the `.slice(0, 30)` cap would have gone untested
against it. Both cases were rebuilt against the real contracts rather than adjusted to fit.

## Mutation pass

**16 of 17 caught**, including restoring the bare 403 on each of the two fixed routes, swapping
`ai-usage`'s arguments, swapping `pending-count`'s two counts, both `time-audit` clamps, truncation
instead of rounding, and the uncapped session list. The survivor is an equivalent mutant planted as
a control — a no-op TypeScript cast.

## Not exercised

The repository is mocked, so the reports' own SQL is not run. The 503 path is proven by making the
admin lookup reject, not by a real outage. Web/Node only — no device, no native, safe-area, gesture
or notification surface.

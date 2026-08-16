# 2026-08-08 — DB/scalability review, second-user audit, and four new CI rules

**Branch:** `claude/token-usage-strategy-7cx7z9` · **Domains:** `platform` (primary), `devices`

## What this session was

The owner had a large token budget and asked which domain was worth spending it on, given a
full-app review had run the day before. The answer, after checking: **the database layer is the one
thing 24 review documents have never covered**, and it is also the only layer currently producing
unexplained faults in production. So this session ran that review, plus a second-user readiness
audit and a dev-tooling pass, and queued everything it found rather than fixing it inline.

Nothing in the app's behaviour changed. The only executable code added is four CI checks.

## What shipped

- [`docs/reviews/2026-08-08-db-scalability-and-tooling-review.md`](../../reviews/2026-08-08-db-scalability-and-tooling-review.md)
  — the review.
- **Four new `Custom Rules` CI checks**, each tested to pass on the current tree *and* fail on a
  planted violation: `check-migration-numbers.js`, `check-timezone-rendering.js`,
  `check-date-param-regex.js`, `check-component-size.js`.
- **Q-142…Q-145** filed; **Q-30 and Q-107 updated in place** rather than duplicated. (Q-130 was
  updated too, then shipped as #1148 before this branch merged — its entry is gone from the queue and
  the corrections it carried now live in the CI scripts' lists.)

## The findings that matter

**The error reporter drops `err.cause` (Q-142) — and this one was overtaken mid-session.**
`lib/observability.ts:8-9` stored `err.message` and `err.stack`, both of which describe the Drizzle
*wrapper* for a `DrizzleQueryError`; the actual Postgres error on `err.cause` was never read. That is
why 98 `Failed query` events over 30 days had no diagnosis. **PR #1150 (Q-107 first half) shipped
exactly that fix the same day, independently** — and its prefix-not-suffix choice (the standing
session-start query groups by `left(message,120)`, so an appended cause is invisible in the read
that matters) is better than the scope note filed here. What survives is the half it did not touch:
`lib/observability/request-error.ts` still drops the cause on the `onRequestError` path, which
covers the 80 route files with no `catch` of their own — more routes than the one just fixed. Q-142
was rewritten to that scope rather than closed.

**The hypothesis behind the fault is probably wrong anyway.** Grouping the 98 failures by the second
they landed in: 77 are a lone query failing while everything else in flight succeeded, 12 in pairs,
and 4+5 in two bursts. Pool exhaustion fails everything competing for a connection at once — that
shape accounts for 21 of 98, so Q-107's queued `getSyncDelta` batching fix may address the smaller
half. Recorded on Q-107 with a concrete next step: now that the `code` capture has landed, one
production read settles it — a `57014` majority means `statement_timeout` and the batching fix is
aimed right; codeless connection-acquisition failures mean something else. Read the codes first.

**The DB volume problem is re-accumulating and the queued fix cannot stop it (Q-30 update).**
205 MB post-REINDEX on 2026-07-21 → **421 MB on 2026-08-08**, ≈12 MB/day; `oura_raw_samples` row
count doubled in 18 days. Q-46's guard stopped index *bloat*; the remaining Q-30 work is console
actions that reclaim bloat too. At this rate the database alone returns to the ~924 MB alarm level
in about six weeks regardless. Only D4 or a retention policy changes the direction. Related:
CLAUDE.md's ~3.2 MB/day figure describes the device-local window and has been read as the server
rate, which is ~3× higher.

**Three `TODO(tz)` markers were an orphaned finding (Q-144).** `adapter.ts:1051`, `:1109`,
`slices/oura.ts:1074` acknowledge that `DEFAULT_TZ` is assumed on read paths, with zero references
anywhere in the backlog or `projectOverview.md`. A user outside Brisbane gets Brisbane day
boundaries, silently. The "app is AEST-only in practice" premise in those comments no longer holds.

## What was checked and found clean

Recorded so it is not re-derived: index coverage on every hot table is good (no missing-index
finding); `users` showing 895k sequential scans and zero index scans is *correct* at a handful of
rows, not a defect; the BLE ingest hot path is properly bounded, coalesced and backgrounded, with
the only unbounded full-history reads confined to two admin diagnostics; rate-limit keys are all
user-scoped with no shared buckets; module-level server state is user-keyed.

## Two things worth carrying forward as method

**A check with a blind spot is worse than a hand-written list.** The first version of
`check-date-param-regex.js` required `regex(` or `z.string(` on the same line, and silently missed
two `const DATE_RE = /…/` copies — including one Q-130 had already named by hand. Caught only by
diffing the script's output against the entry it was meant to supersede. It now keys on the anchored
regex literal itself.

**Every grandfather list is shrink-only, and that earned its keep within the session.** All three
list-bearing checks fail if a listed file is fixed but left in the list. Q-130 shipped (#1148) while
this branch was open and widened 7 of the 11 dash-only regexes; merging `main` made the check fail
with *"these files no longer carry a dash-only date regex — remove them from GRANDFATHERED"*, naming
all seven. A hand-written list would have gone on claiming eleven indefinitely. Four remain — all
files Q-130 never knew about.

**One rule was attempted and dropped:** `var(--x)` reaching a canvas/chart.js paint API. No reliable
grep separates it from a React inline `style={{ borderColor: 'var(--x)' }}`, which is valid — every
candidate produced false positives on real styles. That belongs in an ESLint rule with an AST, not a
grep. Not filed as a backlog item: it is a tooling idea, not a defect.

## Not done

No `EXPLAIN ANALYZE` — the read-only `claude_ro` role reaches curated views, so query *plans* are
inferred from scan counters and table shape, not observed. Confirming them needs a Railway console
session. The second-user findings are static analysis; no real second account was driven through
the app, which remains the natural follow-up. No device, emulator or browser this session — but
nothing here touches a device path.

The Q-119…Q-138 review batch was deliberately left alone: two other agents were draining it in
parallel throughout this session (Q-122, Q-123a, Q-124, Q-128, Q-129, Q-134 landed; Q-119, Q-120 in
flight), and a third agent working the same queue would only have caused conflicts.

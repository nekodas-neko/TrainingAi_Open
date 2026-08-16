# 2026-08-14 — the table the meal-plan prefill needs, and nothing reading it yet (Q-187 phase 2, slice 1)

**Branch:** `claude/trainingai-backlog-v0abea` · **No version bump:** nothing user-visible ships here.

Phase 1 (v1.299.0) put a one-tap "I ate this" on the plan card — deliberately the half that needs
none of this machinery, because the tap *is* the confirmation. This is the other half's foundation:
the durable state, provable on its own, with no UI attached.

The backlog entry stays open. It is annotated, not removed.

## The design, and the one it rejects

A prefilled meal is *suggested*, not eaten. If a prefilled row reached `food_logs`, the day's totals
would count food nobody ate — energy balance, macro rings, adherence, and the AI's view of the day,
all silently wrong.

The obvious fix is a `confirmed_at` column on `food_logs` and a filter at every read. **23 files read
that table**, in the domain with this project's worst data-loss history, and one missed reader is a
wrong number the owner acts on. That is a sibling sweep with 23 chances to be half-done, and this
repo has shipped exactly that failure before — the soft-delete burn-down took 35 sites and its own
session.

So unconfirmed prefills never enter `food_logs` at all. No reader can miscount because there is
nothing to miscount, and **zero of the 23 readers change**. The cost is one table plus its sync path,
which is smaller than 23 audited readers.

**Only declines are stored.** "I ate it" stays derivable — the food is in the day, which is how phase
1 already matches it — and a row asserting it beside the food log would be two sources of truth for
one fact. "I did not eat it" is the half that is not derivable at all: an absent food log is
indistinguishable from an unanswered prompt, and a prefill that keeps re-asking after being declined
is worse than no prefill. The `CHECK (answer IN ('no'))` is deliberate, not an unfinished enum.

## Two things the tests caught rather than confirmed

**Re-declining after an undo inserted a second row.** The unique index is partial on
`deleted_at IS NULL`, so a soft-deleted row is invisible to the conflict target — the insert simply
succeeded and the table held two rows for the same meal and day. `listPlanMealAnswers` filtered the
dead one out, so from the app it looked correct; it would only ever have surfaced as row growth.
Reviving first, unconditionally, collapses both cases into one path. The case was written because the
partial index looked like a trap, and it was.

**The domain union and the sync-health label map were compile errors** the moment the outbox domain
was added — the structural guard in `mutation-schema.ts` doing what its comment promises, rather than
a `food_items`-style silent drop.

## The CI failure, which was a gap in the local gate rather than the diff

The suite passed locally and **failed on CI**. Not flaky, and not the diff:

`claude-ro-readonly-role.test.ts` is pinned to the newest `claude_ro` views migration. Each such
migration DROPs and rebuilds the whole schema, so applying 185 rebuilt it without a view for the new
table, and the coverage assertion failed at **80 views against 81 tables**. The file's own comment
asks for the repoint in the same commit and warns the pin "went stale silently between 181 and 185" —
adding a *table* rather than a column is what makes it bite.

**Why it was invisible locally: the `DATABASE_URL` form.** The session hook exports the Unix-socket
URL, under which that whole file *skips*. The local run said `470 files | 1 skipped` and read as
green. Under the TCP form it is `471 files, 3,900 tests, none skipped` — and it reproduces the CI
failure exactly. `CLAUDE.md` documents this trap; it was read past.

Two habits from it: **run role-sensitive suites under the TCP URL**, and **treat a nonzero skip count
as something to explain**, not as noise. Verified the fix is the fix — reverting the pin to 185 fails
with `expected 80 to be 81`, restoring it passes.

## Verified

Nine DB-backed cases. **Mutation-verified three ways:** dropping the two-level ownership join fails
the cross-user case; hard-deleting instead of soft-deleting fails 2; filtering `deleted_at` in the
delta — the classic tombstone-hiding mistake — fails the propagation case.

**Observed on the live dev server:** decline → read → undo → re-decline round-trips; a `YYYY/MM/DD`
slash date works (the format `localDateString()` actually emits — a dash-only regex here would have
rejected every real request, as it did to ai-chat for a full release); an unknown or non-owned meal
id returns 404; `2026-02-31` returns 400.

`tsc --noEmit` clean, lint 0 errors, `pnpm check:rules` 33 of 33, `pnpm build` passes.

## Owed, and deliberately not done

- **The prefill UI.** Held until the parallel lane's Q-237 lands, so `nutrition-content.tsx` has one
  owner at a time. Slice 1 is complete on its own terms; nothing reads the table yet, which is the
  plan's own sequencing.
- **`getSyncDelta` is now a 24-query fan-out.** Q-107 already flags its width as a pool-contention
  suspect. Added to knowingly rather than silently.
- **One line in the other lane's files.** `components/more/sync-health-card.tsx` needed a label for
  the new domain — a compile error otherwise, not a design change.
- **Not device-verified, and this one carries more risk than most.** Local SQLite and the outbox do
  not run in the sandbox, and **local v25 has never run on a phone**; v26 stacks on it. If Saved
  Meals or the plan card comes up blank after this ships, **revert rather than debug forward.**

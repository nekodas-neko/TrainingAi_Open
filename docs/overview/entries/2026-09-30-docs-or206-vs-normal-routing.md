# 2026-09-30 — the head of Lane B's queue held three items, and none of them was Lane B's

**Branch:** `docs/or206-vs-normal-routing` · docs only, no code.

`node scripts/next-item.js --lane B` printed **5 READY** with `OR-206` at the head and `TN-67`
second. Re-verifying both against `main` before starting — the standing rule that a plan can go
stale while it sits in the queue — found that **neither could be started from Lane B**, for the same
reason in both cases: the buildable half is an engine, and this lane owns surfaces. Routing them
took Lane B's READY list from 5 to 3, and every remaining one is genuinely startable.

## `OR-206` — the rename is a schema change, and the question inside it was invisible

The entry asks for one copy change (*"Compared to yesterday"* → *compared to normal*) and attaches
two things to it. Both belonged elsewhere, and CLAUDE.md names each case outright.

**① The field rename and the history marker are Lane A's alone.** `vs_yesterday` reaches
`schema.ts`, `adapter.ts` (five sites, including an `EXCLUDED.vs_yesterday` upsert), two API routes,
two `packages/shared` files, three `lib/local-store` files, `lib/sqlite/migrations.ts` and
`claude-ro-views.sql` — reached by grep and confirmed by `tsc`. A Postgres migration and a local
SQLite version are Lane A's by rule, and the rule says the finding agent **stops and hands the item
over**. Filed as **`LB-190`** (`Lane: A`), with `OR-206` waiting on it via `Needs:`.

It has to lead rather than follow, which is the part worth keeping: **the copy change is what makes
the stored answers ambiguous.** Rows written before it answer *"vs yesterday"*, rows after answer
*"vs normal"*, and the entry is right that they must not be pooled — the field feeds a scoring
input. A deploy date cannot mark the boundary exactly, because Railway ships on merge and one local
day can hold rows from both sides of the cutover, so `LB-190` recommends a stored question-version
integer, the shape `SLEEP_VERDICT_MODEL_VERSION` already set on this same sheet.

**② The default-selection question was an owner decision living inside a `Lane: B` body**, where the
Orchestrator was never going to see it — the exact trap CLAUDE.md describes, and the one `RV-208`
already hit when its Lane A half stayed described in a Lane B entry until it moved out to `LB-183`.
Filed as **`LB-191`** (`Lane: O`, **ungated** — `Gate: owner` would park it out of the READY list,
and getting the answer *is* the work), with the brief written in the shape the decision rule asks
for: recommendation first, the alternative and what it is genuinely better at, reversal cost.

The recommendation is to ship the rename with **no** default and offer him `TN-82`'s
announce-and-correct shape instead, because the measured record here is unambiguous: `wake_mood`
collected 17 answers then zero, the 1–5 sleep scale 3 of 82, `vs_yesterday` itself 2 of 82, and
`perceived_recovery` **0 touched in 102 check-ins**. A pre-selected neutral makes a reflexive Save
indistinguishable from a considered *"about the same"*. His actual ask — not tapping three things on
a normal morning — is what the sleep announcement already solves on this sheet.

## `TN-67` — "Now Lane B" pointed at an engine that does not exist

The entry's own `Lane:` field says *"nothing to build"*; a ✅ block added on 2026-09-27 says
*"Now Lane B"* for an outlier-gated rating prompt and to *"copy `OR-171`'s threshold"*. So it printed
second on an implementer's READY list carrying, between its two halves, no implementable work.

**Checked by listing the directories rather than by reading around it:**
`packages/shared/src/health/` holds `sleep-verdict.ts`, `readiness-composite.ts` and
`live-readiness.ts`; `app/api/` holds `sleep-verdict` and `readiness-score`. **There is no readiness
equivalent of either half** — no trailing-window outlier rule, and no route a sheet could ask *"is
today unusual?"*. `OR-171`'s threshold is `VERDICT_IQR_MULTIPLIER` inside a `packages/shared` engine
reaching its surface through `/api/sleep-verdict`. Engine-first, both files Lane A's. Filed as
**`LB-192`** (`Lane: A`) and **`LB-193`** (`Lane: B`, `Needs: LB-192`), and `TN-67` re-laned to `T`,
since what remains in it is the dated re-measurement its own last line assigns to Tuning.

**⚠ Two things carried into `LB-192` that reading the entry alone would have lost.** Its instruction
to copy the threshold must not become copying the number: `VERDICT_IQR_MULTIPLIER` is 1.0 because it
was swept to 4–6 prompts a month over the owner's own nights, and `TN-83` records that the first
sweep used the wrong population (raw `sleep_sessions` rows, naps included) and so understated how
loud the rule was. Readiness has its own spread; the rate is the target and the multiplier is only
how it is reached.

And the two owner-approved designs genuinely collide, which `LB-193` says rather than resolves
silently: `TN-67` asks for a **prompt** on outlier days, while `OR-171` — the entry it says to copy
— concluded it should **not ask at all**, and `TN-82` shipped that. An outlier-gated question is a
fourth affordance on a sheet where asking has failed four times. `LB-193` recommends gating the
existing prompt's *prominence* rather than its existence, reusing `SleepAnnouncement`'s two tiers.

## Verified

`node scripts/check-backlog-pointers.js` — **522 entries, no duplicates, all tagged, 82 `Needs:`
with no cycles and all targets known**, exit 0. `node scripts/next-item.js --lane B` — READY 5 → 3,
with `LB-193` correctly parked behind `LB-192`.

## Not done

**No code, deliberately.** Every buildable half named here is filed for the lane that owns it; none
of it was started in this PR. `LB-191` is a question and is nobody's to answer but the owner's.

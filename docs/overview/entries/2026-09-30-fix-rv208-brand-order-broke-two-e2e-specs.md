# 2026-09-30 — my own change had two e2e specs red for four PRs, and the crash beside them is LB-149's witness

**Branch:** `fix/rv208-brand-order-broke-two-e2e-specs` · no version bump — two spec fixes, one guard
case, and two entries updated.

`#2016` merged with all five required checks green and **three E2E shards red**. E2E is advisory, so
it blocked nothing. Reading it anyway — which is a lesson already in the baton — found five failures
with three different causes, and **two of them were mine**.

## The five failures, attributed

| spec | cause |
|---|---|
| `food-row-shared` | **mine** — RV-208 ⑤'s brand reorder |
| `single-foods-database-search` | **mine** — same |
| `lb186-new-exercise-has-a-style` | `LB-149`'s browser death |
| `meal-portion-scale` | `LB-149`'s browser death |
| `meal-type-reassign` | **passes locally on this tree** — not reproduced |

## The two that were mine

Both asserted an accessible name of `<brand> — <name>` — `/Spec Dairy — Spec Mismatch Yoghurt/` and
`` new RegExp(`${BRAND} — ${PRODUCT}`) `` — which is exactly the string RV-208 ⑤ retired when it
moved the brand off the name line and onto `FoodRow`'s secondary. **Red from v1.486.4 to v1.486.9.**

**Three things had to line up for that to stay invisible**, and all three are true of this repo:

1. `pnpm test` is **vitest only** and never runs Playwright, so the local gate I ran before every
   one of those PRs could not see it.
2. The source guards I wrote for RV-208 ⑤ scan **`components/`**, not `e2e/`. They passed, correctly,
   on a change that had broken the suite.
3. **E2E is advisory here** (owner's call, pending `LB-56`), so three red shards blocked no merge.

I censused `<FoodRow` call sites and every `${…brand…}` interpolation in `app/` and `components/`.
I never grepped `e2e/`. That is the whole of it.

Both specs now assert the name line and the brand as **two** things rather than one joined string, so
a row that dropped the brand entirely — which is what `ingredient-search.tsx` was doing before
RV-208 ⑤ — cannot pass a name-only check either.

The guard gained the case, **scoped to those two files with the reason stated** rather than dressed
up as a general rule: one legitimate em dash in an accessible name exists in the suite
(`plan-meal-log-decline.spec.ts`'s *"Didn't eat this — undo"*), so a blanket ban would be noise.
**What generalises is the habit, not the assertion: when you change a rendered string, grep `e2e/`
for it.**

## ⚑ And beside them, the witness LB-149 has been waiting for

Both `browser has been closed` failures carry the same line in their browser log:

```
Received signal 11 SEGV_MAPERR 0000000001b0
```

**SIGSEGV with `SEGV_MAPERR` is a near-null dereference, not a kill** — an OOM would be SIGKILL with
an `Out of memory` line. So **memory is out as the explanation**, and the dmesg instrument LB-149
built for that hypothesis no longer has a question to answer.

Four things the backtrace establishes:

- **The same fault address in two independent failures**, which points at one reproducible code path
  rather than random corruption.
- **It is the browser process, not a renderer** — the stack runs through `libglib-2.0`'s main loop
  into Chromium's own message pump, which is exactly why `browser.newContext` then fails for every
  later test in the shard.
- **The binary is pinned and named:** `chrome-headless-shell-1234`.
- **The frames are unsymbolised**, so *which* path it is stays unestablished — and nothing here
  shows the crash is our page's doing at all.

Written onto `LB-149` with the next step revised: a SIGSEGV in a pinned Chromium is a **harness**
question, not a product one, and the remedy (a Playwright bump, or a flag that avoids the path) is a
decision about the harness rather than a fix to make unilaterally.

**The artifact was readable because this run was not capped.** The baton records that a capped run
publishes nothing — this one published three reports, and the repository-scoped REST path
(`api.github.com/repos/<owner>/<repo>/actions/artifacts/<id>/zip`) fetched them, as `LB-149` already
documents. `get_job_logs`' tail was Postgres teardown, again.

## The one I could not reproduce

`meal-type-reassign` failed in CI with **0 radios where 6 were expected** in the "Move N entries"
dialog, and **passes locally on this tree**. It is not claimed fixed and not filed as a regression:
one CI failure that does not reproduce is shard state or a flake, and *"flake" is not a root cause* —
if it recurs it will have a second data point to work from.

## Verified

- `e2e/food-row-shared.spec.ts` and `e2e/single-foods-database-search.spec.ts` — **5 passing**
  between them, plus `meal-type-reassign` green, run together locally.
- `components/nutrition/__tests__/rv208-brand-follows-food-name.test.ts` — **6 tests**, the new case
  among them.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 86 of 86** · `check-backlog-pointers` exit 0.

## Not exercised

- **The other three E2E shards in full.** Only the specs named here were re-run; a full local E2E
  pass is ~35 minutes and this change touches two spec files and one test.
- **Whether `meal-type-reassign` is sound.** It passed once locally. That is not the same as knowing
  what happened in CI.
- **LB-149's actual cause.** Narrowed, not established — and deliberately not acted on here.

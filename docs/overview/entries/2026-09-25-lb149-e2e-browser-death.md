# 2026-09-25 — the E2E browser dies and the run says nothing; four theories eliminated, one witness added

**Branch:** `lane-b/lb149-e2e-browser-death` · **Lane:** Implementation B

LB-149 was filed after two runs ended with the Playwright browser simply gone — two specs each
failing in 1.0s with `browser.newContext: Target page, context or browser has been closed`. A
1-second failure before any test body runs is a process that has died, not an assertion.

This PR does **not** establish the cause. What it does is remove four explanations that were
costing sessions, and give the next failure a witness.

## What is no longer worth testing

**The entry's own leading hypothesis is dead.** It proposed checking "worker count against runner
memory" and whether `--workers=1` removes it. `playwright.config.ts` **already sets `workers: 1`**,
with a comment explaining why (the specs share one seeded Postgres and one signed-in user). There is
no parallelism to reduce; the suggested remedy is the standing state.

**Nothing closes the browser deliberately.** No `browser.close()` anywhere under `e2e/`.

**"Memory accumulates through the run" does not fit.** The victims were `day-detail-sheets` and
`diary-nested-meal` — **#20 and #28 of 124** specs in alphabetical run order. Early, and not
adjacent to each other.

**"A heavy spec killed it" does not fit either** — and this one is the useful inversion. Because the
failure is at `newContext`, the browser was already dead *when the victim started*, so the victims
were never the suspects: the specs that were actually running when it died are the ones **before**
them. Those are `collection-screen` — 36 lines, one test, one `goto` — and
`details-tests-and-scans`. Two of the lightest files in the suite.

## What is left, and why the PR stops there

That leaves the runner. The shape is at least consistent with `pnpm dev`: the crash clusters early
because early is when the dev server compiles hardest, nothing being warm yet — which would explain
why a trivial spec can be the one holding the axe. **Consistent is not established**, and the
honest position is that no run so far recorded a single byte about why the process went away.

So rather than ship a theory, `ci.yml` now answers the question on the next failure:

```yaml
- name: If the browser died, say why
  if: failure() && steps.ui.outputs.changed == 'true'
```

One `dmesg` read. An OOM kill names the process and its RSS; an **empty** dmesg eliminates memory
outright — which is just as valuable and is precisely what nobody has been able to say. It runs only
on failure, so a green run pays nothing.

## Measurement, and a correction

The entry asks for three consecutive runs on an unchanged head — same victims means a spec pair,
moving victims means the runner. **Run 3069 passed** (`pnpm e2e`, 28m53s), so the fault is
intermittent; that is 1 of 3, and attempt 2 was re-run from the same head rather than by pushing
empty commits. Those reruns execute the *old* `ci.yml`, so they answer "do the victims move", not
"why".

Also corrected: `ci.yml` described the full E2E job as costing "~10 min". Measured on that run it is
**~29**, which matters because it is the number anyone waiting on a UI PR is implicitly told.

## A test that expired for the third time, and this PR's own lesson

CI went red on the first push, on `scripts/__tests__/next-item-visible-silence.test.ts` (TN-61) —
a file whose own comment reads *"this case has now broken twice for the same reason: it encoded a
fact about the DATA rather than the behaviour"* and *"a test that names a lane is a test that
expires."*

It was right, and this was the third time. The assertion was `ready > 10` implies a truncation line.
But the cap is on **rows**, and a batch is one row carrying several entries — so the two part
company as soon as enough batches sit near the top. Measured here: lane B printed **all 12** of its
READY entries inside 10 rows, three of them batches, and correctly said nothing; the test demanded
a truncation line for work that was in front of the reader. `next-item.js` was not wrong.

It now compares the entries the output actually PRINTS against READY's own count, which is the
behaviour rather than today's batch shape. Two things were needed to make that hold: the READY block
runs to the next **section header** (column 0), not to the next blank line — `--lane O` and
`--lane DV` print an indented note about owed device checks after a blank, so stopping at the blank
counted zero entries in exactly the two lanes most likely to be truncated. And the fix was
mutation-tested: reintroducing the original silence in `next-item.js` turns both assertions red with
the right messages, and restoring it turns them green.

**The lesson is mine, not the test's.** I skipped the full suite on this PR, reasoning that the diff
contained no TypeScript — a YAML comment and a backlog entry. That is true and it was the wrong
inference: the diff changed **data the tests assert against**. A backlog edit is a code change as far
as the queue-tooling tests are concerned, and the five files I hand-picked as "the ones that read
ci.yml" could not have caught it.

## Not this lane's

The entry's other half — *"because E2E is advisory nobody looks"* — is a question about making E2E
a required check. `CLAUDE.md` records that as deliberate and the owner's, pending `LB-56`. Nothing
here changes it.

**Not exercised:** the diagnostic step itself has not fired, because no E2E run has failed since it
was written. It is gated on `failure()`, so a green CI run on this PR proves the YAML parses and
nothing more.

# 2026-09-28 — RV-213 declined and struck; LB-178's start point investigated

**Lane B.** Branch `fix/nutrition-empty-meal-slots`. Docs only — no code, no version bump.

## Why this is a strike and not a build

`RV-213` proposed collapsing each empty meal slot on the nutrition diary to a single name-plus-`+`
row: roughly **1,400 px → 800 px**, with two cards previously under the fold — the goal-versus-budget
explainer and "Finished logging for today?" — reaching the same screen. A before/after was rendered
at 384 px dark and shown with `LB-163` and `LA-136` in one sitting.

**He declined it**, and gave the reason when asked: *"I like the original look; it shows the grouping
nicely with the space."*

So the empty height the sweep measured is **doing work** — it is what separates one meal from the
next. The saving was real and was paid for in the thing the screen exists to show. The entry's own
instruction is *"Nothing is owed. Strike this entry — a declined change is finished, not parked"*,
and it was still sitting at the head of Lane B's READY list, so `next-item.js` was pointing the lane
at work the owner had already said no to.

## Where the principle went, and why not here

The entry asked for this to be recorded as a **principle for the pillar, not a one-off no** — a
future sweep measuring blank space on the diary will reach the same finding and should stop. A
journal entry is the wrong home for that: nobody greps the journal before filing. It is now in
[`docs/domains/nutrition/README.md`](../../domains/nutrition/README.md) under *Decided, and
deliberately not built*, which is the subject-based index a sweep reads first, alongside the
`suggestedTime`-stays-a-label decision it sits naturally beside.

## The half that was not disputed, and is still not a to-do

The finding also noted that an empty meal renders a header `+` (`components/nutrition/meal-card.tsx:73`)
**and** a body `+ Add food` (`:105`) — two affordances for one action. That was never disputed, and
it is deliberately **not** re-filed: the header `+` is the control present in *every* meal state,
while the body row is the empty-state one, so the pair is consistency rather than duplication.
Filing it as its own entry would be re-opening a declined entry through a side door — the entry is
explicit that re-opening needs a new reason, and "he only objected to the density" is not one.

## What is kept

The declined mockup stays at
[`docs/design/2026-09-27-four-screen-mockups.html`](../../design/2026-09-27-four-screen-mockups.html),
linked from the principle, so the next person can see what was rejected rather than re-drawing it.

## Also here: `LB-178`'s start point, and a refuted suspect

Both items edit `docs/implementation-backlog.md`, and that file is the repo's most frequent
multi-PR conflict, so they ship as one PR rather than two racing each other.

`LB-178` named `tn53-sparkline-does-not-span-gaps:105` as where to start — the only spec flaky in
**all three** CI censuses. The entry's stated suspect is shared database state (*"the suite runs
`workers: 1` against one seeded database"*). **For this spec that is refuted:**

- **Reproduction failed both ways.** Alone: 3 passed. Run after the four other specs that write
  `body_metrics` (`one-calorie-budget`, `measured-overview`, `reta-weight-response`,
  `metric-bounds-at-keyboard`): 11 passed.
- **Nothing else writes the column it asserts on.** A census of `resting_heart_rate` across `e2e/`
  returns two files — this spec, and `rv72-progress-bars-composite`, whose match is a `page.route`
  **stub**, not a database write. No other spec can add or remove a point from its 14-day window.
- **Nothing mutates the other input to that window** either: `LOCAL_TODAY` derives from
  `users.timezone`, and the only `UPDATE users` in `e2e/` are a `date_of_birth` backfill and a
  `display_name` reset.

**So the next step changes.** Every E2E run already uploads a `playwright-report` artifact, and
Playwright retains the **first attempt** of a flaky test in it — which says in one look whether the
failure was the 60 s wait for the card heading (load), the `3 days missing` text (data), or the
header-width measurement (layout). Those are three unrelated causes. Shuffling spec order is the
expensive way to answer something the artifact answers on every run.

**A cheaper thing learned the hard way:** the job *log* is not a substitute. It is ~9,000 lines and
its tail is container teardown, so a `tail_lines` fetch returns Postgres checkpoint noise instead of
the Playwright summary. That is recorded on the entry so the next session does not pay for it again.

## Not exercised

**No root cause for `tn53:105`, and none is claimed** — this is a negative result that narrows the
search, not a fix. Deliberately nothing was changed in the spec: "flake" is not a root cause, and
editing a spec that passes locally, on a hypothesis the evidence just refuted, is how a real defect
gets papered over. No code changed at all; `check-backlog-pointers` and `check-doc-links` pass, and
the queue is 538 entries, down one.

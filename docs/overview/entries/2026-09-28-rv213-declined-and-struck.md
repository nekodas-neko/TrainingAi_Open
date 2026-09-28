# 2026-09-28 — RV-213 declined: blank space on the diary is the grouping

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

## Not exercised

Nothing to exercise — no code changed. `check-backlog-pointers` and `check-doc-links` pass; the queue
is 538 entries, down one.

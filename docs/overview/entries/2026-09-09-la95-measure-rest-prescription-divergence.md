# 2026-09-09 — measuring the two rest prescriptions, and fielding my own queue head (LA-95)

**PR:** `lane-a/la95-measure-and-gate` · **Lane A** · docs only, nothing implemented.

## I filed LA-95 an hour earlier and it went straight to the top of my own queue

The entry says, in its own words, *"filed rather than fixed: changing it moves numbers the owner
already reads, so it is a decision, not a tidy-up"*. It then printed as **READY (1)** on the next
`next-item.js` run, because I gave it no `Gate:` field.

That is exactly the trap #1047 existed to fix — `next-item.js` classifies on the `Keep:`/`Needs:`/
`Gate:` **fields**, not on prose, so an entry that says "do not start this" in a sentence still heads
the work list. I fixed it for four other entries that morning and then reproduced it myself the same
day, on an entry I wrote *because* I understood the distinction.

**Writing the reason in the body is not filing.** The field is the interface.

## The measurement the entry demanded, taken rather than deferred

LA-95's last line asked for *"how many sessions change before shipping it"*. Rather than only add the
gate, that number is now on the entry — a gated decision with no evidence is a question the owner
cannot answer.

Against production, over the route's own 90-day window, sets carrying both rest columns:

| | |
|---|---|
| Sets where the two prescriptions disagree | **231 of 442 (52%)** |
| Sessions whose adherence percentage moves | **28 of 36 (78%)** |
| Mean shift | **11.2 points** |
| Max shift | **31 points** |
| **Sessions crossing a bucket boundary** | **14 of 36 (39%)** |

Every set had a live style to compare against, so none of the disagreement is missing data.

**The bucket-crossing number is the one that matters.** The view renders `<70 / 70–90 / 90–115 /
115+`, so 14 sessions moving bucket means the chart visibly redraws and the `insight` sentence is
re-derived from different bars.

## What it settles, and what it deliberately does not

It settles that this is not a rounding correction, so "fix it quietly" is off the table.

It does **not** settle which number is right, and the entry now says so. The logged snapshot is the
honest record of what the plan asked at the time; today's style is what the owner is actually
training to. For a trend asking *"does resting to plan go with lifting better?"* both readings are
defensible, and only the owner knows which question they read the chart for. That is why it is
`Gate: owner` rather than a bug I should have fixed while I was in the file.

**Not exercised:** nothing was implemented. The numbers come from `claude_ro` over production, which
is row-scoped to the owner — so they describe the owner's training, which is the only training this
chart draws.

# 2026-09-15 — the lane sweep: one entry was being offered to both lanes at once

**Branch:** `chore/or-116-lane-dispatch` · backlog, batons and one check script. No product code.

## The dispatch failures, worst first

**BF-100 had no `Lane:` and was printing in READY for BOTH lanes simultaneously.** Two agents could
have picked up the same entry on the same morning. It is the one failure mode that makes
`next-item.js` actively misleading rather than merely incomplete, and it survived because the other
seventeen lane-less entries were all parked, so nothing else exposed it. Assigned **Lane B** by the
path rule; seventeen more assigned with it.

**Four finished entries were sitting at the head of a lane's work list** — BF-141, BF-135, LB-47,
BF-64. Lane B had already diagnosed three of them and filed **LB-109** asking the Orchestrator to
clear them, which is exactly the right escalation and is now done. LB-47 and BF-64 went out under a
shared note recording that **nothing verified either fix**, per LB-109's own insistence that they not
be swept in with the genuinely verified two.

**Lane A's baton claimed READY was nine entries and all nine were standing exclusions.** It is 14 and
six are startable, **LA-76 among them** — released by the owner yesterday, and half of it needs no
migration because a deload *session* is already dated. A stale "nothing startable" reads exactly like
a true one, which is why that line is corrected in place with the count that falsifies it.

**BF-126 was re-parked.** Yesterday's sweep removed its `Gate: owner` because the decision had been
made — right about the decision, wrong about the entry. The blocker moved to the artwork rather than
clearing, so Lane B would have found an afternoon's wiring and no assets. The gate now names the
asset.

## The check I wrote yesterday had the wrong half of the class

`keepIsSettled` keyed on `VERIFIED ON THE S25`. **A look that comes back FAILED is just as settled —
and the entry it leaves behind is worse**: not shipped-work-advertising-debt, but *live, unbuilt work
filed as finished*. Widened to read all three outcomes, and it immediately found two:

- **TN-13** — and it moved the lane. The owner's check showed the cue does not render; the cause is
  `RING_GEOMETRY.showDot`, true for **one of eighteen** ring styles. So the defect is in
  `components/oura-score-chip-row.tsx`, not the shared helper the entry named, and the entry went
  **A → B**. The number itself is right: Home read 60, `body_metrics` holds 60 for today against a
  54–57 baseline — **so the cue that failed to render would have said about `+4 vs usual`. The
  feature failed on the one day it had something to say.**
- **BF-74** — failed on 2026-09-13 (the photo ✕ destroys on a single tap with only an undo toast) and
  kept both fields saying a check was owed. Its struck `Keep:` is retained as the fix's acceptance
  test, because what it asks — whether the toast is reachable before it dismisses — is the half a
  browser cannot judge.

`backlog-verify-field.test.ts` asserted this state could not exist. It now admits a third outcome,
and its `stillOwed` list is **legitimately empty**: all seventeen of its snapshot are worked through.

## One new entry, one revert

**OR-116** — Home's `60`, Health's bare Resting HR tile and `/health/heart-rate`'s 73/50/89/125 are
one signal rendered with three different amounts of context and no qualifier anywhere. Nothing
computes a wrong number; the owner compared them and reasonably concluded something was broken.

**PS-4's lane assignment was reverted.** The entry argues in its own body for staying unclassified —
each role rewrites its own baton, so it is done by whoever hands over next. Recorded in place, since
the next sweep will be tempted the same way.

## Round five's answers

Q-1b deferred a third time **with a trigger** (v2), and the number it asked for is on the entry so it
is not re-derived. BF-106 and LB-52 both accepted and deferred — re-offer, do not re-argue. The
calorie model confirmed working on the S25, which closes the question under BF-134/142/154 rather
than another copy edit. RV-38 routed to Tuning at the owner's direction.

## Result

Queue **327 → 326**; `Verify: device` **22 → 20**. Lane-less entries **21 → 2**, both correctly so
(`Q-253` is a `Reference:`, `PS-4` deliberate). No entry appears in two lanes.

`check-backlog-pointers` clean on 326 · `pnpm check:rules` **Ran 75 of 75** · 267 script tests green.

**Surfaces not exercised:** none apply — backlog, batons and one Node check script. No product code,
so nothing reaches the APK from this PR.

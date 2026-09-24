# 2026-09-24 — acting on the device agent's sweep 2/3 handover

Orchestrator. Docs-only. Branch `chore/or-140-device-sweep-handover`.

The Device Verification agent finished sweeps 2 and 3, released the phone, and handed over a list.
Most of it needed nothing: `DV-15`/`DV-16`/`DV-17`/`DV-18` were already filed and correctly laned,
and the six deployed-but-still-failing fixes carry their FAILED measurements on the entries. Four
things were wrong, and one request is declined with its reason.

## Four corrections

**`RV-111` — a gate that outlived its answer.** It carried `Gate: device` reading *"the hardware
back path only exists on the APK"*. True when written; sweep 2 then **CONFIRMED the defect on the
S25**, which also settles the open question OR-137 raised — whether the native barcode activity
swallows back before the JS listener runs. It does not, so the written fix is the right fix. Gate
removed; this is Lane B work, not a check.

**`RV-127` — a failed probe filed as shipped.** It carried `Verify: device — no build half`, which
files an entry under *shipped, a look is owed*. Sweep 2 ran it and the inputs came back at **21 px
of ink, ~33 px of touch area** against the 44 px floor — so there is a build half. Removed. A
FAILED is work, and leaving the field on reads as finished to everyone who scans the queue.

**`RV-144` filed, Lane B.** `RV-127`'s one actionable finding, handed to the lane that owns the
surface: three inputs on `/more/details`. Measured twice — the first pass said *"not judged; whether
their row or label widens the target is the next question"*, and sweep 2 asked that question and got
~33 px. The `tap-target-dot` session dots it also found are **by design** (44 in the axis that
matters) and must not be "fixed"; the horizontal overflow was looked at on screen and overlaps
nothing.

**`RV-127` re-laned `O` → `DV`.** It was held in `O` to get its findings to the right lanes; that
filing is now done, and the only thing left is the clearance half, which three-button navigation
cannot answer.

## One request declined, with the reason

The handover asked: *"Q-168 is tagged Lane DV but isn't a device check; please re-lane it."*
**It is staying, and the argument is on the entry** so it outlives the exchange.

Read literally, the claim does not hold: `Q-168`'s *What is actually left* section has **one** item,
and it is running the AI Coach section of the smoke checklist on two navless full-screen routes.
Sending it to `B` would give Lane B **nothing to build** — the cardio-goals half was dropped rather
than deferred — so it would sit there unstartable, which is worse than sitting in `DV`.

**What is true is the constraint the same message supplied**, and it explains the entry better than
the re-lane would: the phone is on **three-button navigation**, where every safe-area inset reports
`0`. A bottom-anchored control clears the bar trivially in that mode and a broken floored utility
passes anyway, so running this now would manufacture a **false VERIFIED** — worse than not running
it. That is already why `RV-37` and `RV-127`'s clearance half were held for sweep 4. `Q-168` belongs
in that group; it was not a fourth kind of thing.

So it is held for sweep 4, not re-laned. **This is a disagreement resolved by a fact the device
agent supplied, not by seniority** — and it is written down because the last one (Q-168 again, this
morning) was left standing and cost a second round.

## Not done

- **No product code**, no device run.
- **`#1465` is still open and still carries value** — the `BF-92`/`BF-24`/`Q-395` re-lanings never
  landed, and `main` has no test pinning `LA-132`'s ENOBUFS fix. Its own `maxBuffer` line is now
  redundant (LA-132 fixed it independently) and its `RV-111` routing is obsolete (see above). It
  needs salvaging, not merging as-is. Separate PR.
- **Sweep 4's list is started, not finished** — `Q-168`, `RV-37` and `RV-127`'s clearance half are
  the gesture-nav group. The rest of the tagging pass is still owed.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps, 812 test files passed.

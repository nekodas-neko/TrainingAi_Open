# 2026-09-14 — a done entry was carrying two live findings (RV-36 → BF-100 + LB-107)

**Branch:** `chore/refile-shipped-rv36` · **Lane B** · docs-only, no version bump

## What I found taking the top of the queue

RV-36 printed as READY. It had **shipped on 2026-09-11**
([journal](../history-2026-09-14-folded-1.md#2026-09-11-fix-nutrition-scroll-and-day-padding)) and was **verified on the S25 on
2026-09-13** — one of six that passed that sitting. There was nothing to build.

Re-verifying the premise before implementing is what caught it. The entry would otherwise have been
re-implemented, which is what its own text warns against: *"Do not re-fix this blind. It has been
declared fixed twice."*

## But it was not safe to just delete

Two live items were recorded **inside its body**, and nowhere else in the queue:

**1. BF-100 failed on the S25, for the second time.** Owner: *"Checked on more - and still doesnt
work"*. That failure had been pasted into RV-36's body, while BF-100 itself still read:

```
- **Keep:** the device pass, and only that.
- **Verify:** device — on the S25, scroll a tab screen well down…
```

So it printed under *"shipped; a look is owed, nothing is blocked"* — while the look had been taken
twice and failed both times. **That is the trap the `Verify:` field's own documentation names**
(OR-105): unbuilt work filed where nobody goes looking. Deleting RV-36 would have taken the only
record of the failure with it, leaving BF-100 reading as merely unchecked.

It is now a plain buildable entry and prints as READY.

**2. The owner asked for something that had no entry at all.** *"Just need to make sure when you
press back on a tab and there is no where to go it should go to the home screen."* A distinct
requirement — RV-36 was about restoring an offset, this is about where the back gesture goes when
the stack is empty. Filed as **LB-107**.

## The detail worth keeping about BF-100

It is a **device-only failure and the harness says the opposite**: measured in Playwright, `/more` →
*Profile details* → back restores **840**. A green `e2e/scroll-restoration.spec.ts` is therefore not
evidence, and the entry now says so, because reading it as evidence is how this gets declared fixed
a third time.

## This is the third burial this session, in a third field

- `Reference:` filed LA-102 and TN-28 as read-only (LB-104).
- `Verify:` filed BF-100 as awaiting a look it had already failed.
- A **shipped entry's body** held BF-100's failure and an unfiled owner request.

Same shape each time: a real item in a place the queue tells the lane not to look. The first two have
checks or documentation now. The third does not, and probably cannot — no tool can tell a note
parked in the wrong entry from one that belongs there. What it argues for is the habit the protocol
already states: clear a completed entry *when you reach it*, because the longer it sits the more
gets written into it.

## What was NOT done

- **Neither new entry was implemented.** BF-100 and LB-107 both need the S25 — one is a device-only
  failure the harness contradicts, the other is a hardware gesture Playwright cannot send. Filing
  them accurately is the whole of this change.
- **The other 32 KEEP entries were not audited** for the same mis-framing. BF-100 was found because
  RV-36 pointed at it, not by a sweep; there may be more, and a sweep is Orchestrator's.
- **RV-36's own journal and S25 verification were taken at their word**, not re-checked on device.

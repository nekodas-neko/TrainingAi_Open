# 2026-09-23 — OR-136: the three gates with no reason, and a gate that blocked its own lane

**Branch:** `chore/or-136-device-gate-reasons` · **Lane:** O · queue state only

`--lane DV` goes **9 READY → 11 READY, 0 PARKED.** Three entries carried a device gate with no
reason after it; none of the three turned out to mean the same thing.

## The three

**`Q-168` — the reason was written, just not beside the field.** Its own *What is actually left*
section says it plainly: `/coach` and `/coach/confirm/[toolCallId]` are navless full-screen routes
with bottom-anchored controls, the shape that has regressed 11+ times, and the AI Coach section of
the smoke checklist is what settles it. **Reassigned from `B` to `DV`** — that check is one the
phone answers, because a bottom-anchored control either clears the gesture bar or it does not and a
safe-area inset is a number rather than a matter of taste. The cardio-goals half was dropped rather
than built, so nothing waits on Lane B. A FAILED result goes back to B with what reproduces it.

**`Q-7b` — the gate was simply wrong.** Nothing in it is a question the phone answers: ten
`oura_daily_derived` columns have no producer, which is engine work, and the producer they wait for
is the on-device rollup — `Q-545`'s build. Recorded as a dependency on Q-545 instead of a gate
nobody could discharge.

**`PS-12` — already answered.** OR-135 had written its reason the day before (it waits on the Colmi
R09, not the S25). The flag was stale.

## The shape that kept appearing: a gate naming its own lane

Removing Q-168's gate surfaced `DV-8` sitting under PARKED with `Lane: DV` and `Gate: device` — the
device agent's own work, hidden from the device agent by a gate naming the device agent. **A gate
names what someone ELSE must do first. When the lane and the gate name the same actor there is
nothing to wait for**, and the entry is simply that actor's work.

Filed by the device agent itself, which is how easily this hides. Q-168 acquired the same shape the
moment it moved to DV, and removing it there was the fix rather than a second thought.

## And then a decorative glyph parked it

With the gate off, Q-168 moved to **UNMIGRATED MARKER**. Its line opened `⛔ Device verification —
the blocking one`, and the queue parser reads that glyph followed by *block* within forty characters
as a real marker. The glyph was decorative; *"the blocking one"* was prose.

That is **`TN-59`'s class caught live** — an entry parked by a prose marker alone, invisible to
everyone. Reworded rather than left: say what blocks in words, keep the glyph for a field.

## Worth carrying

Three entries, one symptom, three different causes: a reason written in the wrong place, a gate that
was factually wrong, and a flag that was already stale. **Bulk-releasing them on the assumption they
were all circular would have been wrong twice**, and OR-134 said so when it declined to guess. That
restraint is what this entry spent.

## The same test broke again, for the same underlying reason

`next-item-visible-silence.test.ts` failed a second time in two passes. This morning it asserted the
DV output *"does not contain `showing`"* and went red when `RV-128` — *"does the tab switch drop a
frame **showing** neither panel?"* — entered the lane. I fixed that by matching the truncation
line's shape, **and left the other half of the mistake in place**: it still used DV as its
everything-fits case, hard-wiring the fact that DV was small. Today DV reached 11 and it went red
again.

Both failures are one error: **the test encoded a fact about the data rather than the behaviour.**
It now asserts the invariant across every lane — the truncation line appears if and only if the cap
hid something, and its total matches that lane's READY count. **A test that names a lane is a test
that expires.**

## Not done

- **The remaining ~105 device checks stay on their building lanes.** Most correctly so.
- **`Q-7b`'s separate finding is untouched**: `/api/training-stress` computes an OTS yet the column
  is empty across all history, so its gating conditions are never met in practice — a live route
  returning gated forever, which is a different failure from "no producer exists". It stays in the
  entry, unfiled, and should become its own item.
- **No product code**, no device run.

## Gate

`pnpm ci:local` — exit 0, **Ran 76 of 76** Custom Rules steps. Full log kept, not tailed.

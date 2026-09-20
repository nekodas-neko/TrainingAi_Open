# 2026-09-20 — no double log, but the re-tick moved the dose time; and "Manage supplements" is a 10 px "Manage"

**BugFix intake.** Docs-only. Owner: *"In that attempt i unclicked the button then re clicked it so
check if that caused double recording"* and *"I dont see a manage supplements section to change the
default to 1mg."* **BF-185** and **BF-186**, batched.

## BF-185 — the good news and the finding

**No double recording.** `supplement_logs` for Retatrutide still holds exactly 3 rows, none
soft-deleted. The toggle upserts the day's row rather than inserting a second.

**But the re-tick moved `taken_at`, silently.** Same row, across two production reads:

| field | before | after |
|---|---|---|
| `created_at` | 10:46:35 | 10:46:35 |
| **`taken_at`** | **10:46:33** | **11:21:13** |

35 minutes — 20:46 → 21:21 Brisbane. The injection happened once; the stamp now records the last
button press.

This is the one field BF-184's whole purpose depends on (*"dosage night vs hr"*), and nothing in the
UI says it changed. The fix is to preserve the original stamp on a re-tick — with the caveat that
re-ticking is currently the *only* way to correct a wrong time, so the entry insists on deciding
what an intentional edit looks like before removing the accidental one.

## BF-186 — the instruction names a thing that does not exist

The vial sheet says *"changed in **Manage supplements**, under Amount."* The control is labelled
**"Manage"**, at `text-[10px]` in muted grey with a 12 px icon, in the Supplements section header of
a different screen — visually matched to the `text-[10px]` "SUPPLEMENTS" label beside it. Words
differ, styling reads as decoration, and it is behind the sheet giving the instruction.

The tap target is roughly 12–14 px against the repo's 44 px rule, so the same line carries a second
defect; the fix should make it a `Button` variant rather than restyle a bare element, per the repo's
own rule about where tap-target floors live.

**Why it is not a nit:** the hint exists because his saved default (0.5 mg) no longer matches what he
takes (1 mg). The app correctly flags a stale default, then points at a door he cannot find — so the
default stays stale and a hurried tap logs 0.5 mg. That is the most likely explanation for dose 1
being recorded at 0.5 with no time.

## What was not exercised

Nothing on the S25. BF-185 was verified by two production reads of the same row, which is what caught
the moved stamp; BF-186 was read in source. Both carry a device check — one for the toggle's timing,
one because discoverability and tap target are physical properties of the screen.

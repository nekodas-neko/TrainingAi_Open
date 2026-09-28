# BF-215 — the entry's recommendation would have been a no-op

**Branch:** `fix/strap-low-water-mark` · **Lane B** · `lib/stores/**`, `lib/hooks/**`,
`components/**`.

The owner asked *"Strap battery is at 100... it was 30 last time I used it? Is this working?"* It
was. BugFix measured production and found exactly two distinct values ever recorded: `100` across
four days, and `30` inside one 92-minute window. A CR2025 cannot recharge, so `100 → 30 → 100` is
not a state of charge — it is the cell drooping under a sustained BLE session and recovering at
rest. The defect is the consequence: **the cell only reads low while it is under load, which is when
he is training and not looking at Home.** By the time he looks, it says 100.

## The recommendation was falsified before it was built

The entry recommended *"the LOWEST reading from the most recent connected session"*.
`PolarGattClient.readBattery` is called **once per connection** — from the descriptor-write callback
when HR notifications are enabled, with no periodic re-read — so the battery value cannot move
inside a session, and a within-session minimum is the reading itself. The 17 rows of `30` are status
posts carrying one reading, not 17 measurements.

The defect the entry names is untouched by that; only its granularity was wrong. The mark is tracked
**across connections** instead, over a rolling 14-day window.

## Why a window, and why 14 days

Nothing can detect a cell change: a fresh CR2025 and a dying one both read 100 at rest. So the mark
has to age out rather than be reset. Long enough to span several workouts, so the sag is still on
screen when the question is asked — *"should I change the cell before this one?"* — and short enough
that a replaced cell clears itself. That is a judgement, not a measurement, and it is written down
as one.

## What shipped

`StrapBatteryReading` gains `min`/`minAt`; `writeStrapBattery` lowers the mark and never raises it
inside the window. An entry written before this reads as **its own** mark rather than a missing
field, so the chip is correct from the first render with no migration and no blank state.

The chip draws the mark. It does **not** grow a label: the header's left column measures 224 px at
412 dp and BF-139 moved the `%` off the glass for exactly that reason, so the explanation lives in
the accessible name — `Strap battery 30% at its lowest 2d ago, 100% at rest`. A mark announcing
itself as a live level would be this same defect wearing a different hat.

The tone and icon follow the mark, so the chip goes amber or red on the sag rather than on the
recovery. That is the warning the owner wanted and the reason the number is worth drawing at all.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors, 827 warnings · six new store cases · the
render spec green.

**Control-run:** against `origin/main` the sag case fails — the chip draws `100` — while both
no-change cases pass in either run, so the spec is not a tautology and the unchanged behaviour is
genuinely unchanged.

**The low-battery notification cannot have broken.** `DeviceBatteryNotifier.decide` is Kotlin, fed
the raw percent by `onBattery`, and nothing in this change is native — `git status` carries no
`android/` path. It is still named as the thing to confirm on the device, because "provably
unaffected" and "observed firing" are different claims.

**Not exercised:** a real strap. Every reading here was seeded, so nothing has seen the mark move
because a cell actually sagged. A Known-Issues row states the pass test across a workout.

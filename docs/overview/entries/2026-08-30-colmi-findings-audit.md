# 2026-08-30 — audit the ring session's findings, and file the one that was scoring

Branch `chore/colmi-findings-audit` · docs only

## Why

Four days of Colmi validation produced findings faster than they were filed. This is the sweep that
checks each one reached the queue, and it caught the most serious one sitting nowhere.

## What was already filed

PS-8 through PS-12, PS-15, PS-16, and a `projectOverview.md` row on the comparison harness. PS-14
(the e2e flake) was closed by Lane B in v1.389.1 — the cause was the service worker, not the remount
this session guessed at, which is a fifth wrong inference in that thread and worth remembering.

## What was not, and one of them was live

**PS-17 — a phantom afternoon "sleep" replaced a real night in the daily summary.** Found by
accident while validating an unrelated device. `aggregateOuraRawSamples` emits daytime sessions, and
where a day has more than one, the summary takes the wrong one: 2026-08-27 scored from an 11:35–16:52
"nap" instead of the 23:02–06:37 night, giving that day an HRV of **26.5** against a surrounding
53–72 and a resting HR of **64** against 50–53. Three phantom sessions exist across 27/29/30 Aug,
one of them 0 hours at efficiency 0. Two defects — the detector has no wake gate, and the summary has
no night-picking rule — plus a corrective recompute, because the 27th is wrong on disk.

**PS-18 — a sleep revision is undetectable afterwards.** The rollup replaces rows rather than
updating them, so `created_at == updated_at` on every row and a revision *is* a new row. The
2026-08-27 night moved its wake time 56 minutes between two reads half an hour apart, and that was
only visible because the earlier values happened to have been written down by hand.

**PS-19 — three metrics were never compared at all.** SpO₂ (blocked: `oura_bucket` returns no rows
for any date, unexplained), temperature, and the sleep stage mapping — which is a guess written in a
schema comment and verified against nothing.

**PS-20 — the 0x73 frames, and a copy fix.** Three archived frames, decodable without another
capture. Plus: a radio held by the scale reports as a missing ring, which the owner hit and which the
message should say plainly.

**PS-11 rewritten.** It still read "FIRST OVERNIGHT SYNC ⭐ TOMORROW'S JOB" for a night four days
past. Now states what the capture settled and keeps the one thing still owed: a workout wearing the
Colmi and the H10 together, which is the only ground truth available for the daytime heart rate.

## The pattern worth keeping

Every one of these was spoken aloud in the session and three of them were promised to the backlog
and then not written. The rule already exists — a finding without a queue entry is a dropped finding
— and it failed here because the work kept moving. An audit pass at the end of a long investigation
is cheaper than re-deriving a scoring bug from four days of chat.

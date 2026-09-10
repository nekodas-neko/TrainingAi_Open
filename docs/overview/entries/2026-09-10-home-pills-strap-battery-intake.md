# 2026-09-10 — Home header chips and the strap battery gauge (BugFix intake)

Two owner reports from one Home screenshot, traced to source and filed. Docs-only; no code changed.

## BF-139 — three header chips no longer fit beside the date

Q-111 shipped two battery chips into a row that already compressed badly, and wrote the risk down
at the time: whether three pills plus `EEEE d MMMM` fits at 412 dp was *"a hardware question"*.
The screenshot answers it. `header-meta-row.tsx:39` carries `overflow-hidden` as a deliberate floor,
every chip is `shrink-0 whitespace-nowrap`, and the date is the only item that can give — so at
412 dp the ~232 px left column takes ~201 px of chips and the date renders empty.

That matters because BF-96's standing instruction was *"shorten the DATE, not the chip"*. With the
date already at zero that lever is spent, which is what makes the owner's requested lever — smaller
pills — the remaining one. BF-96 and Q-111 were both amended in place rather than left to contradict
the new entry.

## BF-140 — the strap battery chip cannot go stale

The owner's read was that the app has the wrong metric. It has the right metric with a fabricated
timestamp.

The value is a genuine `0x2A19` Battery Service read (`PolarGattClient.kt:192-194`), taken once per
connection. But `PolarStrapService.battery` is assigned at `:232` and never cleared — no reset on
disconnect, none on stop — so `status()` republishes it for the life of the service process. The JS
then calls `getStatus()` on every Home mount (`use-strap-battery.ts:41`) and `writeStrapBattery`
stamps `at: Date.now()`, so the stored age measures when JS last looked rather than when the strap
last reported. `DeviceBatteryChip` only dims and only names an age past 180 minutes, so with `at`
continuously refreshed the staleness affordance can never fire. The screenshot corroborates it: full
opacity, green icon — the code believed that reading was under three hours old.

Fix shape is to carry the reading's own time from native; `writeStrapBattery` already takes a `now`
parameter that every caller omits. Clearing `battery` on disconnect alone would blank a chip whose
whole purpose is last-seen-when-disconnected.

The underlying 100% is **not** claimed to be wrong. A CR2025 discharges flat for most of its ~400 h,
so a long plateau is what a truthful gauge looks like. The point is that nothing can currently tell
the owner either way: the strap keeps one overwritten `localStorage` key and no server-side history,
against the ring's `oura_ble_battery_poll` — measured this session, **9,578 polls spanning 9%–100%**
between 2026-07-19 and 2026-09-10.

## Not exercised

Neither report was reproduced in the sandbox. The seeded DB has no weather snapshot, so `WeatherChip`
renders a skeleton and the three-chip width cannot be measured off-device; `getPolarBle()` returns
null off-device, so the strap path does not execute at all. Both entries carry `Verify: device`.
BF-139's one open question — which edge — was closed the same day: the owner confirmed the right
side, so the `overflow-hidden` clip is the cause and the `pt-safe` hypothesis is ruled out.

## BF-141 — a lb/kg toggle on the weight dial (filed later the same day)

The owner asked for a small unit toggle on the logging dial: enter in pounds for the few dumbbells
that are imperial, store the kilogram equivalent. Traced, it is prevention rather than convenience.

Session 119 (2026-06-15) records this exact failure on this exact exercise — Dumbbell Lateral
Raise, along with Preacher Curl and Shoulder Press, logged in pounds into the kilogram field,
inflating 1RM, target80, volume and personal records. The repair still exists as an admin
preview/apply tool that rescales derived figures and backdates the personal record. Nothing has
changed since to prevent a recurrence: the write payload carries no unit and `set_logs.weight_kg`
has no companion column, so a pound value validates cleanly and lands as kilograms.

The sharper argument is that the kilogram dial cannot express the hardware. It steps 1.25 kg for
non-barbell equipment, which is 2.76 lb — a grid with no pound dumbbell on it. A 20 lb dumbbell is
9.07 kg and the dial offers 8.75 or 10.00. The logged Lateral Raise history sits at 5.5–11.25 kg
across 54 sets: kilogram-grid values standing in for pound hardware.

Most of the plumbing exists — `WeightDial` already takes a `unit` prop, and `quantity-editor.tsx`
already pairs a vertical `SegmentedTabs` units toggle with a numeric control. The conversion
constant exists too, but in the Postgres adapter, so the engine half is moving it to
`packages/shared` rather than writing a second copy.

The entry flags one hazard that would silently ruin the feature: `mround125` clamps to [5, 250], so
a 5 lb dumbbell at 2.27 kg would be floored to 5 kg. Converted values must not pass through it.

Filing this also discharged an orphaned finding. `projectOverview.md` claimed that when the dead
Kg/Lbs switch was deleted, real unit display was "filed as the feature it would actually be". It
was not — no such entry existed. That line is corrected to point at BF-141.

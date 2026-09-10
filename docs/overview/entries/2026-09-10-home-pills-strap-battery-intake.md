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
BF-139 also records that the owner's *"a little cutoff"* was not pinned to an edge — the right-edge
clip above is the likely cause, but the header carries `pt-safe`, and the two causes need different
fixes.

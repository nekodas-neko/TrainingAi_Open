# BF-140 — the strap battery chip could not go stale

**Branch:** `lane-a/bf140-strap-battery-timestamp` · **Lane A** · no migration · **needs a new APK.**

## The defect, and why the owner's instinct was half right

The owner sent a Home screenshot of the strap chip at 100% — *"I have had it for months now and used
it. I imagine we dont have the correct metric."*

**The metric is right; the timestamp attached to it is invented.** The number is a real read of the
standard Battery Service characteristic `0x2A19`, issued once per connection.
`PolarStrapService.battery` is then written once and never cleared — no reset on disconnect, none on
stop — and `status()` publishes it unconditionally. The JS stamped `at: Date.now()` every time it
read that field, so the stored time was **when JS last looked**, not when the strap last reported.

The consequence is that the staleness affordance could never fire. `DeviceBatteryChip` dims past 180
minutes and only then names an age; with `at` refreshed on every Home mount, `stale` was permanently
false. A months-old reading was pixel-identical to a live one — which is precisely what the
screenshot shows.

Every claim in the entry checked out against the source: field declared at `:70`, assigned only at
`:232`, published at `:392`.

## What shipped

`batteryAt` stamped in `onBattery` beside the percentage, published from `status()`, threaded
through the hook into `writeStrapBattery` — whose `now` parameter already existed and which every
caller had been omitting.

## The skew the entry did not mention, and which decides the design

**The two halves ship on different clocks.** JS reaches the device through a Railway deploy
immediately; Kotlin waits for an APK rebuild. So there is a real window where the new bundle runs
against an APK that sends no `batteryAt`.

`writeStrapBattery(percent, at ?? undefined)` falls through to the `Date.now()` default there, which
reproduces today's behaviour exactly — the right answer, because in that window the timestamp does
not exist to be carried. Nothing is worse in the meantime and nothing is better until the APK lands.
A non-finite time is guarded the same way: a NaN would make `ageMinutes` NaN and leave the chip
neither fresh nor stale, which is worse than the bug it replaces.

## What I could not verify, stated plainly

**The Kotlin cannot be compiled here** — no Android SDK, Gradle download proxy-blocked — **and the
behaviour cannot be exercised**, because `getPolarBle()` returns null off-device. Seven tests cover
the JS half and the native/JS contract by reading the Kotlin source; the running mechanism is
untested. A `projectOverview.md` Known-Issues row marks it NOT device-verified with the concrete
check: post-BF-140 APK, strap off three hours, chip should dim and read *"last seen Nh ago"*.

Mutation pass: the native stamp removed, the native publish removed, the non-finite guard removed,
and both halves of the hook's threading reverted — **five mutants, all killed**; an equivalent
control (`> 100` → `>= 101` on an integer percent) survived.

## Deliberately not built

The strap keeps **no battery history** — one overwritten `localStorage` key, nothing server-side —
so *"has it moved in months?"* remains unanswerable, which is the owner's question from the other
side. The ring can answer it about itself (`oura_ble_battery_poll`: 9,578 polls spanning 9%–100%).
That is a schema change and deserves its own entry rather than being batched behind a native fix
nobody can verify yet.

**Do not read this as "the 100% was wrong."** The H10 runs a CR2025 coin cell whose discharge curve
is flat for most of its life, so a long plateau at 100% is what a truthful gauge looks like. The
defect was that nothing in the app could tell the owner either way.

# 2026-09-09 — the three ring-device probes (PS-39, 30 → 27)

**Branch:** `test/oura-ble-device-routes` · **No product change.**

12 cases over `oura-ble/battery-latest`, `oura-ble/battery-analytics` and
`oura-ble/daytime-coverage` — the same ring read from three angles.

## What the cases decide

- **The first two sit on opposite sides of the admin line on purpose.** `battery-latest` is what the
  Ring Status card calls, so it is owner-authed; `battery-analytics` is an R&D probe and is
  admin-gated. Gating the first breaks the card for a non-admin; leaving the second open publishes
  the owner's telemetry. Both halves are asserted.
- **"Latest" means the highest timestamp, not the last row returned.** The Oura Cloud battery has
  been frozen since the 2026-07-07 re-key, so this reading is the only live one — presenting a stale
  poll as current is exactly what the card exists to avoid.
- **`battery-analytics` reads two series over ONE window** — the forward-only 0x61 history and the
  higher-resolution keepalive polls. Two windows would compare different spans while still returning
  a plausible-looking object.
- **`daytime-coverage` threads the caller's timezone**, because its entire output is hour-of-day
  buckets: in the wrong zone every bucket shifts and the answer to "does the ring stream while
  worn-idle" is wrong in a way that still looks like data.

## Two fixtures that decided nothing until the mutation pass said so

**The poll list is deliberately unsorted with the newest in the middle.** With the newest last,
`reduce`-to-the-max and "take the last row" agree, and the rule the case is named for goes untested.

**The analyser's output had to be asserted, not just the counters around it.** `analyzeRingBattery`
is spread into the response, and the first draft checked only `eventCount`, `days` and `livePolls` —
so replacing the events with an empty array survived. The case now pins `avgDailyDrainPct` (6% over
three hours is 48%/day), `levelSampleCount` and `spanDays`, all derived from the events themselves.

A third fixture was wrong in my favour: setting only the JWT `isAdmin: false` left the sibling
answering 200, because `requireAdmin` ignores the claim by design. The database now says non-admin
too — the rule working, caught by the test failing for the right reason.

## One difference pinned rather than endorsed

`battery-analytics` caps its window at 30 days; **`daytime-coverage` has no upper bound at all**, so
`?days=99999` scans the whole table. It is admin-only, rate-limited, and the person typing the query
is the one who waits for it — which is why this is recorded here rather than filed. But the
asymmetry between two neighbouring routes looks deliberate and is not, so a reader should find it
stated.

## Mutation pass

**16 of 17 caught**, including both "latest" mis-picks, the window widths, the age unit, the split
windows, the timezone, and each route's user scoping. The survivor is an equivalent mutant planted
as a control — a no-op TypeScript cast.

## Not exercised

The repository is mocked — no database and no ring. `analyzeRingBattery` runs for real; the ring
telemetry feeding it is a fixture. Web/Node only: no device, no native, safe-area, gesture or
notification surface.

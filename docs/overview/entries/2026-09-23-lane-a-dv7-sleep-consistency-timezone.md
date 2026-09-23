# 2026-09-23 — DV-7: a helper that read the device's clock, and a test that only passed in UTC

**Branch:** `lane-a/dv7-sleep-consistency-tz` · **Lane A** · `packages/shared/**`. No migration, no
schema change, no API change.

## The entry was accurate, and I checked it rather than assuming

`minutesFromNoon(iso, tz?)` computed `d.getHours() * 60 + d.getMinutes()` when `tz` was omitted —
the **device's** clock, which is what CLAUDE.md's Timezone section bans for anything user-facing.
Reproduced before touching anything:

```
TZ=UTC                 → 6 passed
TZ=Australia/Brisbane  → 2 failed
    expected 690 not to be 690
    expected 1312.5 to be close to 712.5, difference 600
```

600 minutes is the UTC↔Brisbane offset exactly. CI runs in UTC, so this never went red there — and
the owner's phone sits in the zone the data was recorded in, so it never showed on the device
either. The test encoded the same assumption it was meant to catch: it compared the explicit-tz
result against the **no-tz** result and asserted they differ, which is only true when the runner
is not in Brisbane.

## The fix, and why a default rather than a required parameter

`tz` now defaults to `DEFAULT_TZ` and the device-local branch is **gone** — there is no code path
left that reads the machine's clock.

Making `tz` required was the other option and would be stricter. It was rejected because it forces
edits to `app/health/sleep/sleep-content.tsx` and `components/health/sleep-timing-trend-utils.ts`,
both **Lane B** files, and **DV-9 already exists** to thread the session timezone into the first of
them. The default removes the wrong behaviour immediately for every caller; DV-9 then upgrades the
caller from *the owner's zone* to *the user's zone*. This matches the repo's existing shape
(`aestMidnight`, `getCalendarData`), with the caveat CLAUDE.md attaches to it: a default every
caller overrides is a safety net, and it is what makes forgetting silent.

Both **server** callers already passed `tz` — `app/api/user/bedtime-estimate` and
`app/api/health-trends`. Only the two client callers omitted it.

## The tests now pin their own zone on both sides

Every case names `Australia/Brisbane` or `America/New_York` explicitly, and two new cases assert
the default is the user's zone rather than the machine's. Verified across four runners:

| TZ | result |
|---|---|
| `UTC` | 8 passed |
| `Australia/Brisbane` | 8 passed |
| `America/New_York` | 8 passed |
| `Etc/GMT-13` | 8 passed |

`Etc/GMT-13` shares an offset with none of the fixtures, which is the point — a fixture that reads
the ambient clock is not a weaker test, it is a test of the runner.

## Mutation pass

| # | mutation | UTC | Brisbane |
|---|---|---|---|
| 1 | restore the device-local fallback | **4 failed** | **2 failed** |
| 2 | apply `tz` to only the first sleepStart | **1 failed** | **1 failed** |
| C | parse `H:m` in one `formatInTimeZone` call | 8 passed | 8 passed |

Mutant 1 is the measure of the improvement: the **old** suite passed under UTC with that exact bug
present. The new one fails in both zones, so the defect can no longer hide behind the runner.

## The surface half, which a red test forced and the lane rule already required

`components/health/sleep-timing-trend-utils.ts` plotted bedtime through `minutesFromNoon` and wake
through its own `d.getHours()`. With the helper no longer reading the device, those two halves of
one chart would have sat in two different zones on any phone outside Brisbane.

I first filed that as a Lane B entry and moved on. **The consumer test then went red** —
`expected '9:30 AM' to be '11:30 PM'` — because its fixtures were bare local-time strings that
`new Date` parses in the runner's zone. That is not a Lane boundary question any more: a red test
cannot ship, and CLAUDE.md's own rule for a change that is both engine and surface is Lane A, engine
half first.

So `timingPoints` now takes `tz = DEFAULT_TZ` and resolves **both** modes through
`minutesFromNoon`, deriving wake as `(fromNoon + 720) % 1440` rather than re-reading the clock —
one clock implementation in the file, not two (One Formula, One Place). Its fixtures carry explicit
`+10:00` offsets, and two new cases assert that changing the zone moves *both* modes by the same
offset and that the default is the user's zone rather than the runner's:

| TZ | result |
|---|---|
| `UTC` | 10 passed |
| `Australia/Brisbane` | 10 passed |
| `America/New_York` | 10 passed |
| `Etc/GMT-13` | 10 passed |

Mutation pass on that half: reverting wake to the device clock kills 3 cases in both zones;
accepting `tz` but not forwarding it kills 1; undoing the noon shift as `(x - 720 + 1440) % 1440`
instead of `(x + 720) % 1440` — arithmetically identical — survives.

**LB-131 was rewritten rather than closed.** What remains is genuinely a Lane B job: the card calls
`timingPoints(nights, mode)` and takes the default, so every user gets *Brisbane* rather than their
own zone. That ships with DV-9, which threads the same value into `computeSleepStartConsistency`
one component above.

## Not done

- **`packages/shared/src/utils.ts`'s `localDateString`/`localDatetimeString` were left alone.** They
  are device-local by design and CLAUDE.md names them as one of the two sanctioned client "today"
  sources; changing them is a separate decision, not a drive-by.
- **`app/api/day-log/route.ts:190` looked like the same pattern and is not** — it calls
  `toZonedTime(ws.startedAt, tz)` first, so `.getHours()` reads the target zone. Checked, not
  assumed.
- **Failure surfaces not exercised:** the Sleep screen on the device. This is pure shared-package
  math with no UI, but the number it feeds is user-visible, and the sleep-timing chart above is now
  the subject of LB-131.

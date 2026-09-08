## 2026-09-08 — What the app has measured, under what it was told (BF-133)

**Branch:** `feat/bf-133-user-overview` · **Lane B** · PR #1009

### What shipped

A read-only section on **More → Profile details**: the latest reading of every body metric the app
holds, grouped by what a number is *for* — body composition, vitals, metabolism, daily movement —
plus a sleep block averaged over the window.

Two properties decide whether a dense read-only card is useful or misleading, and both are enforced
in the logic rather than left to the data:

- **Every reading carries the date it was taken.** A scale session from three weeks ago sits beside
  today's step count, and without an "as of" they read as equally current.
- **A metric with no reading is omitted, never blank.** `body_metrics` has six tape-measure columns
  nothing has ever written; rendering every column would have shipped a screen of permanent dashes
  and taught the reader to skip it. Verified in the e2e by asserting all six are absent.

### The BF-118 decision, which is not the one the entry proposed

BF-133 opens with **⚠ FIRST: decide against BF-118**, because both describe a screen called "user
information", and recommends building this as a section of BF-118's screen.

**That screen does not exist.** BF-118 is a large unbuilt entry. What does exist is `/more/details`
("Profile details", BF-79) — name, biological sex, birth year, height, editable, one PATCH — which is
precisely BF-118's *"what you TELL the app"* half, already built under a different name. So the
recommendation stands and the target moved: told above, measured below, one page about you. When
BF-118 is built it should fold into `/more/details` rather than open a second destination.

### The read is local-first because the server window is too short

`/api/body-metadata` returns **seven days**. This card is about the *latest* reading of each metric,
and a composition figure or a scale session is routinely older than a week — so read from the server
alone, most of these show as absent when they exist. `store.getBodyMetrics(cutoff)` returns the full
local history, and `body_metrics` is a domain the app writes locally, so CLAUDE.md's offline-first
rule already required reading it locally. The seven-day payload stays as the web fallback, where
`getLocalStore` returns null.

### The three traps the entry named, and what each became

1. **Stride length is not measured** — `treadmill-utils.ts` computes `(heightCm / 100) × 0.415`, a
   population constant applied to height. Verified in source. It is **not on the card**: presenting an
   anthropometric assumption as a recorded measurement is the thing the entry warned against.
2. **"low / avg / high HR" is three things from three stores.** Every heart-rate row here names its
   window — *Resting heart rate* (daily) and *Lowest heart rate overnight* (from sleep) — so nothing
   silently merges a sleeping rate with a working one.
3. **Two RMR numbers that disagree by construction.** The scale's is labelled *"estimated by the
   scale"* and points at More → DEXA & RMR results, where the lab-measured one lives.

### Averaging bedtimes needed a circular mean

A plain average of clock times is wrong in the direction that matters: bedtimes straddle midnight, so
23:50 and 00:10 average arithmetically to **12:00** — the middle of the next day, and a number that
looks like a real bedtime. `circularMeanMinutes` averages the unit vectors instead and returns 00:00,
and returns **null** rather than picking a side when the directions cancel (times 12 hours apart have
no mean). The minutes-of-day are computed in the *user's* zone before the circle, not the device's.

### Verification

18 unit tests over the logic — latest-reading selection out of order, absent columns, non-finite
values, group dropping, and the circular mean including its midnight case and its ambiguous case.
`e2e/measured-overview.spec.ts` drives the real screen at 412 dp: the section renders, all six tape
measurements are absent, and **every rendered reading matches `YYYY-MM-DD`**.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green.

The rules gate caught one real defect: the year cutoff was built with `toISOString().slice()`, which
is UTC and wrong before 10am AEST. It derives from `todayInTz(tz)` now.

**Not exercised:** the S25 and Samsung WebView. This is a long dense list on a phone and the entry
asks for a scanning look — group headers, aligned numbers, the fold not landing mid-group — so the
device check is a real one, not a formality.

### What is deliberately not built

The training and performance sections: `personal_records`, `fitness_tests`, `dexa_scans` and
`measured_rmr` in this view. The clinical two are reachable today at More → DEXA & RMR results, and
the scale's resting-rate row now points there — so what is missing is the single dense view, not the
numbers. Recorded on BF-133 as its `Keep:`.

Minor bump — a new feature.

# 2026-08-03 — clock times were rendered in the phone's timezone, not the user's

_Branch `fix/device-timezone-formatting` · PR #1026 · v1.252.1 · domains `platform` / `sleep`_

Found while investigating an owner report that sleep wake times had shifted by an hour. **It was not
the cause of that report** — see below — but it is a real defect in the same screen, and it had been
there since long before this session.

## What was wrong

Six user-facing screens formatted a time of day with `toLocaleTimeString` and **no `timeZone`
option**, which renders in whatever zone the *device* is set to rather than the user's:

| Where | What it showed |
|---|---|
| `health-metric-sheet.tsx:92` | the sleep list's "10:29 pm – 7:38 am" |
| `health/hypnogram.tsx:19` | the sleep ribbon's axis labels |
| `health/body-cards/sleep-card.tsx:50` | the sleep card's window |
| `activity/exercise-review-sheet.tsx:105, 206` | detected-activity times |
| `settings/scale-pairing.tsx:183` | scale reading times |

Invisible while the phone sits in the zone the data was recorded in, which is why it survived. On a
device set to New York, the 2026-08-03 wake — stored as `21:05:49Z`, i.e. **7:05 am** Brisbane —
rendered as **5:05 pm**. Measured, not hypothesised.

This is the same class as the banned `new Date().toISOString().slice(0,10)`: an obvious,
well-documented JS API that quietly uses the wrong zone.

## What shipped

`formatTimeOfDay(at, tz = DEFAULT_TZ)` in `packages/shared/src/date-utils.ts` — one place that
decides how a clock time is rendered. Accepts an ISO string, epoch millis or a `Date`, and returns
`''` rather than `"Invalid Date"` for unparseable input.

**The format is byte-identical to what it replaced.** `h:mm aaa` produces exactly the same string as
all five `en-AU` variants in use (`7:05 am`), verified against them in a test — so this changes the
timezone without changing how anything looks.

`components/oura-ble/` and `components/admin/` are deliberately **not** converted: those are
diagnostic consoles where device-local is the useful reading when you are holding the device. The
exemption is stated in `CLAUDE.md` so a later sweep does not "finish the job".

`CLAUDE.md`'s timezone section now lists `toLocale*String` without a `timeZone` as a forbidden
pattern alongside the `toISOString` ones, with this incident as the worked example.

## What this did NOT fix — the report that led here

The owner reported wake times an hour later than expected and asked for a production check. What the
data showed:

- Every night on screen was **+31 to +33 minutes** later than `sleep_end` in the database — a
  constant offset across all seven nights, so not a per-night data problem.
- Every sleep row had been rewritten at **11:11:28 Brisbane**, and the screenshot's clock read
  **11:11**. The rollup re-ran as the screen was being looked at.
- **The owner refreshed and it became 7:05 am**, matching the database. The screen had been showing
  pre-refresh values.

So the app was displaying stale local data, and that day's rollup moved wake times ~31 minutes
**earlier**, not later. The timezone bug above cannot produce a 31-minute offset — no zone is offset
by 31 minutes — so the two are unrelated, and this PR should not be read as closing that report.

**What remains unexplained:** the owner recalls waking at 6:38 while the stored value is 7:05. Some
gap is by design — `actual-window.ts` documents that the displayed end is the end of the *recorded
session*, deliberately not trimmed to the last non-awake block, because the stage totals and the
ribbon axis both span the full window. Whether ~27 minutes of trailing in-bed time is the right thing
to show as "wake time" is a product question, not a bug, and it is not answered here.

## Verification

Five tests on the new helper: renders in the given zone (Brisbane / London / UTC from one instant),
defaults to the app zone rather than the device, **matches the `en-AU` string it replaced**, accepts
all three input types, and returns `''` for garbage.

Re-run under `TZ=America/New_York` to prove the fix ignores the process zone — the old expression
returns `5:05 pm` there, the new one `7:05 am`.

Full suite green (380 files / 2920 tests) and the sleep card verified rendering on the dev server.
One run reported a single failure that did not reproduce and could not be captured; CI is the arbiter.

## Not verified

On-device. Nothing native or offline-first is touched — this is a pure formatting change in shared
code — but the bug is *about* device timezone, and the only way to see it fully closed is a phone
whose zone differs from Brisbane.

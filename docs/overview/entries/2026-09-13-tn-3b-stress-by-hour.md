# 2026-09-13 — stress gets a clock (TN-3b, the today half)

**Branch:** `feat/tn-3b-stress-by-hour` · **Agent:** Implementation Lane B

Owner, approving the entry on 2026-09-10: *"Can we have this displayed on a widget or chart so we can
see when the stress occurs. I will be able to match it up based on time to what I was doing around
then."*

## Why this was sitting unstarted

TN-3b reads as PARKED to `next-item.js`, so it never reached the READY list — but the park is a
**legacy prose marker**, and the entry itself carries `⚑ UNPARKED 2026-09-10`, the owner's approval,
and a note that its stated blocker (TN-3a's persistence) has shipped. The tool cannot see any of
that, because it is prose rather than a field. That is the exact failure the standing rules name —
*"`Needs:` / `Gate:` / `Reference:` are fields, not prose"* — and it cost the entry three days.
Lane B's READY has been 0 throughout.

## What shipped

A 24-hour local-time axis in the Body Battery card, **beside** `stress-strip.tsx` rather than
replacing it: the strip carries the current state and the "high ~N min" figure, this answers *when*.
Each design constraint in the entry came from measured data, and each is implemented:

| constraint | how |
|---|---|
| local-time axis, 30-min resolution | `minutesIntoDay` via `Intl` in the **user's** zone, one viewBox unit per minute |
| **never interpolate a gap** | `toSegments` splits at 75 min; one path per run, so a hole is drawn by nothing being there |
| shade the night band | 22:00–06:00, both halves — the series wraps midnight and one rect cannot span it |
| mark zero and ±0.5 | ruled, and **named in a caption** — see below |
| no score, no verdict | nothing on the surface judges the day |

**The caption is there because the screenshot demanded it.** Rendered, the chart was an amber line
between three unlabelled rules: a reader could see *when* something happened and not *what*. One
sentence names the upper line as the same "High" the strip already says, the shading as night, and
the blanks as unrecorded — a description of the axis, not a verdict, and it reuses the strip's own
vocabulary rather than inventing a second one.

**Why no verdict, explicitly.** Q-507 — whether this metric's sign means what it claims — is open,
and TN-33 established there is no independent target with variance to settle it (`perceived_recovery`
reads 3 on all 17 days, untouched across 29 check-ins). The owner's recall *is* the ground truth,
which is what makes a plain chart the right instrument: it makes no claim that can be wrong, and that
is what keeps it shippable while the question stands. **TN-16's warning and prompt stay parked.**

## Verification

- `components/body-battery/__tests__/stress-day.test.ts` — 9 node tests over the geometry: the
  timezone (13:15 Brisbane vs 22:15 in `Etc/GMT+5` for one instant), midnight placed at 0 rather than
  1440 (`en-GB` renders it `24:00`), the **measured 06:45 → 13:15 hole** splitting into two runs, one
  dropped reading *not* splitting, out-of-order input sorted first, and coverage counting half a
  bucket at each end while excluding gaps.
- `e2e/stress-by-hour.spec.ts` — renders the real 2026-09-08 shape and asserts **two** polylines, the
  labelled hours, and `3.5 h measured`. A second test pins that no series draws no chart.
- **The card is collapsed on arrival, and the first negative test passed without opening it** —
  asserting absence inside a section nobody expanded is a test that cannot fail. Both tests expand
  now, and the negative one first proves the expanded content is there.
- Custom Rules **74 of 74**, `tsc` clean, eslint clean, `pnpm test` clean, `pnpm build` clean.

## What is not done, and why

- **Past days are unreachable, and that is TN-3b's own pass test.** `/api/body-battery` is
  `export async function GET()` — no parameters — so only today is served. The buckets persist
  (`oura_daytime_stress_buckets`, from 2026-08-24) and nothing publishes them. Filed as **LB-102**
  for Lane A; the chart takes a plain array and `toSegments` sorts before segmenting precisely so
  stored rows drop straight in.
- **The HR-chart overlay and the across-days aggregate** are the entry's other two surfaces, still owed.
- **Not device-verified.** Rendered and measured at 412 dp in the harness, not on the S25.

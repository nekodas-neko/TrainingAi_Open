# Device Metrics sparklines stopped stretching partial-day signal to full width (BF-10)

**Branch:** `fix/sparkline-time-axis` · **Lane B** · v1.351.0

## What was wrong

The owner pushed back on a Q-388 answer ("SpO₂ is 98.9% inside 22:00–09:00") with a screenshot of
`/admin/oura-ble`'s Device Metrics panel: Intraday SpO₂ and Intraday temp both filled the *entire*
sparkline width for every day, which reads as continuous all-day sensing and looks like it
contradicts the night-only finding.

It doesn't — the chart couldn't show the contradiction either way. `app/api/oura-ble/device-metrics/route.ts`
already computes a real `tSec` (seconds since local midnight) per sample and returns it on every
point, but `device-metrics-panel.tsx` only ever passed the *value* array into `<Sparkline>`, and
`Sparkline` placed each point at `x: i * step` — array index, evenly spaced, `tSec` never read. So
5,700 SpO₂ samples clustered in an 11-hour night window stretched across the same full width 24
hours of continuous data would. The panel couldn't distinguish "sampled all day" from "sampled for
11 hours, packed left-to-right" — both rendered identically. Daytime HRV has the same shape;
temp's full-width fill in the screenshot happens to be real coverage (confirmed separately by
Q-388's hourly count), which is what made the SpO₂ one look consistent with it.

## What shipped

`Sparkline` (`components/ui/sparkline.tsx`) takes optional `times`/`timeDomain` props. When both are
given it projects `x` by the sample's position within the domain instead of by index; without them
it behaves exactly as before, so the other 27 call sites are untouched. `device-metrics-panel.tsx`
passes `tSec` against a fixed `[0, 86_400]` day domain for all three intraday curves, so a signal
that covers a fraction of the day renders with visible dead space either side rather than being
stretched to fill the card.

## Verification

- Math check: projected a synthetic 11-hour window against the `[0, 86400]` domain — occupies ~46%
  of a 120px width with the rest empty, not the full 120px.
- `pnpm tsc --noEmit`, `eslint` on both changed files — clean (pre-existing `@sentry/nextjs`/`qrcode`
  module errors on unrelated files are an environment gap, fixed by re-running `pnpm install`, not by
  this change).
- `node scripts/check-sparkline-primitive.js` — unaffected (still 3 pre-existing copies, 7 exempt).
- `pnpm check:rules` — Ran 55 of 55.
- **Rendered the real component against real data.** Seeded `oura_raw_samples` (tag `0x8b`) and an
  `oura_ble_clock_anchors` row in the local dev DB for a 2-hour SpO₂ window, confirmed via
  `GET /api/oura-ble/device-metrics` that the route returns the expected `tSec` range, then mounted
  `DeviceMetricsPanel` (off the gated admin page — see below) through a scratch route with Playwright
  and screenshotted it: before the fix the line filled the full width, after it occupied only the
  slice matching the window's share of the day. Scratch route and seeded rows were removed before
  committing.

## The entry's own reproduction premise was wrong

BF-10 said "Surface: web-reproducible… load `/admin/oura-ble`". That doesn't hold on current `main`:
`OuraBleDebug` (`oura-ble-debug.tsx:429`) returns the native-unavailable banner and nothing after it
whenever the native plugin isn't registered, which is always true in `pnpm dev`. `SampleInspector`
and `DeviceMetricsPanel` both sit in that unreachable tail — the panel is only mounted in the APK.
The underlying rendering defect was still real (confirmed from source and by mounting the component
directly, off the gated page), so the fix stands; only the claimed reproduction surface was corrected.

## Not exercised

**Nothing here was seen on the S25, or through the real `/admin/oura-ble` page at all** — the panel
is native-gated, so the only way to see it render is in the APK against a ring's own history with a
genuine partial-day window. The backlog entry keeps a `Keep:` line with `Gate: device` for that
reason.

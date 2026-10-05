# TN-46 — the overlay half: doses plotted against the vitals they move

**Branch:** `feat/tn46-dose-vitals-overlay` · **Version:** 1.483.0

The engine shipped on 2026-09-28 (Lane A): `GET /api/health/dose-vitals?days=60` joins vial-dosed
administrations to each night's resting HR and HRV beside **the baseline stored for that night**.
This is the Lane B half — the chart.

Re-verified against `main` before building: the route exists and returns exactly the payload the
entry describes, including `effectLookbackDays`.

## The lag rule is the design, not a caption

The measured effect peaks **2–4 days** after a dose, so the one thing this card must not do is
invite a same-day reading. That constraint shaped three decisions:

- `buildDoseVitalsSeries` marks a night `inEffectWindow` only from the day **after** a dose, out to
  `effectLookbackDays`. A night sharing its date with a dose is `dosedOn` and explicitly **not** in
  the window — asserted directly, because it is the assertion the whole entry rests on.
- The card says it in words: *"read the days after a ring rather than the ring itself"*.
- The copy states **2–4** literally rather than deriving it from `effectLookbackDays`. The first
  draft computed `lookback - 3`–`lookback - 1`, which happens to print 2–4 today and would have
  silently lied the moment the constant moved.

## Decisions

- **One metric at a time, not two y-axes.** Resting HR is bpm and HRV is ms; a dual axis at 384 px
  invites reading a crossing as a relationship. A toggle instead, following `sleep-trend-toggle-card`.
- **Doses are rings on the metric line**, not a separate series — they mark *when*, and the eye then
  follows the days after them, which is where the effect is.
- **Hosted on Readiness**, in its existing `extraCards` slot: resting HR and HRV are readiness
  inputs, so the overlay sits beside the score they feed rather than on a screen of its own.
- **Absent rather than empty.** With no vial-dosed log in the window there is nothing to annotate,
  and a card saying so is noise on a screen the owner opens daily. It renders `null`.
- **Annotates, never corrects** — the owner's decision, unchanged. Nothing here feeds a score and no
  threshold is tuned against the dosing period.

## Two bugs caught before they shipped

- **The dose list trusted the route's ordering.** `slice(-3).reverse()` rendered oldest-first
  depending on how the route happened to sort; the screenshot is what showed it. Now `latestDoses`
  sorts by date descending and copies before sorting, with a test that feeds it both orders.
- **The e2e hardcoded dates, and `check:rules` caught it.** The route's window is 60 days back from
  the *real* clock, so a pinned fixture drops out of it and the card silently stops rendering on a
  date nobody chose — the time-bomb class CLAUDE.md names. Every fixture date now derives from the
  seeded user's today.

## Verified

- `components/health/__tests__/tn46-dose-vitals-series.test.ts` — **8 tests**, including the dose
  day being excluded from its own effect window, the window ending exactly at the lookback, and a
  month-end walk (`2026-06-29` + 2) going through `shiftDateStr` rather than hand arithmetic.
- `e2e/tn46-dose-vitals-overlay.spec.ts` — **2 tests** at 412 px dark against the real component,
  payload injected (the seed user has no vial-dosed log, so every assertion would otherwise pass
  vacuously against the absence this fills). Covers the drawn card, the stated lag, the metric
  toggle, and the card being absent with no doses. Both rendered states screenshotted.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **956 files, 9,516 passed** · `pnpm build`.

## Cross-lane note

`lib/cache-groups.ts` is Lane A's file. The new key `dose-vitals:` needed registering in the two
groups whose writes change it — `invalidateSupplements` (a dose is logged) and `invalidateOuraSync`
(the nightly vitals) — so this PR adds two additive lines there. Recorded here and in the baton
rather than filed as a separate Lane A entry: `LB-156` was exactly that shape and cost the entry
several days for five one-line registrations.

## Not exercised

- **Real data.** The seeded user has no vial-dosed log, so the chart has only been drawn against an
  injected payload. The shapes in the screenshots are fixture sawtooth, not a real resting-HR trace.
- **The device.** No native, safe-area or gesture change, but this is a new card with a chart on a
  screen the owner reads daily, and `chart.js` rendering in the Samsung WebView is not exercised here.

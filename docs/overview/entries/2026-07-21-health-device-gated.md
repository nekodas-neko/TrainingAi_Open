## 2026-07-21 — Device-gated health UX: back button, Body Battery, Heart & Recovery, live ring battery (v1.192.0)

**Branch:** `feat/health-device-gated` — items #2, #4, #7, #9a of the owner's Health/Training/Workout UX batch.

- **#2 detail-screen back button** — the chevron was a bare icon over the hero art and read as "no back
  button". Now a clearly-visible translucent 40px chip (blurred bg, both themes) with a bigger tap target
  (`components/health/detail-hero.tsx`).
- **#4 Body Battery explainer** — the "how it moves" copy previously only appeared in the empty state.
  Added a persistent "How it moves" bullet block (shown whenever the card is expanded, data or not) that
  ties the four home features to charge/drain (`components/body-battery-card.tsx`).
- **#7 Heart & Recovery** — (a) lifted `MeasureHrNow` out of the Oura-connected-gated `OuraSection` into
  its own `measureHr` card in the "Heart & recovery" group, so it's available with a Polar strap and no
  ring. (b) Added per-metric range scales (RHR / HRV / SpO₂ vs recent days) to `RhrHrvSpo2Card` using the
  shared `MetricScale`/`rangeStats` from #6.
- **#9a live ring battery** — new user-scoped `GET /api/oura-ble/battery-latest` (the existing poll
  routes are admin-gated) returning the latest direct-BLE keepalive poll within 3 days; `OuraSection`
  now prefers it over the frozen Cloud value (shows the live % instead of "Not live") and falls back to
  Cloud when there's no fresh poll.

### Verification
- `pnpm exec tsc --noEmit`, `pnpm lint` (0 errors), `pnpm test` (1793 passed), `pnpm build` — green.
- `pnpm dev`: `/health`, `/health/{readiness,sleep,activity}` render HTTP 200; `/api/oura-ble/battery-latest`
  returns `{latest:null}` (no BLE polls in the seed — endpoint verified, degrades to Cloud correctly).

### NOT verified on device (Known-Issues row added to projectOverview.md)
- Back-button safe-area + back-stack behaviour on the S25; the moved "Measure HR now" card's live-HR
  source (ring vs strap) and safe-area; real BLE battery telemetry (endpoint reads null until the native
  service posts a poll); Heart & Recovery scales need real multi-day data. All require the on-device smoke
  run. Live HR / BLE are APK-only and cannot be exercised in the sandbox.

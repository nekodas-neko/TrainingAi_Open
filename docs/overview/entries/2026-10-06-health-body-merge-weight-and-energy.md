# 2026-10-06 — Health → Body: one weight trend, one energy answer

**Branch:** `chore/health-body-merge-one-energy-one-weight` · **Agent:** Implementation (surface) · Closes #2147, #2146.

Built to `docs/design/2026-09-22-home-health-ia-mockups.html`, which the owner approved on 2026-10-06.

- `WeightTrendCard` now takes the regression slope (`useWeightTrend`) as `kgPerWeek` and draws it as the
  headline above the sparkline and goal bars. Body renders it as `weightTrend`, second in the Body group,
  straight after Body Weight. It renders the slope it is given and does not re-fit anything.
- The old Trend tile and the Balance tile are removed. The Balance tile's number was
  `energyBalance.balance.netKcal`, the same payload as the Net stat on `CalorieBalanceBar`, so the two
  never disagreed in value; `CalorieBalanceBar` needed no change.
- `weightTrendProgress` is out of `PROGRESS_ORDER`: Progress is four cards. Health has no saved section
  order (the orders are constants in `health-content.tsx`), so nothing needed migrating.
- `energyBalanceKcal` is dropped from the sections' props; the `energy-balance` cache key is untouched
  (Energy Balance and Home still read it).
- The mockup's headline says "30 days". `/api/body-metadata` returns the last 7 days, and the slope is fit
  over that, so the card says "last 7 days" instead.
- `check-hex-literals` baseline for `health-sections.tsx` lowered 39 → 33.

Not exercised: on-device rendering (Samsung WebView, safe area), a profile with weight and body-fat targets
set (the goal bars), and the light theme.

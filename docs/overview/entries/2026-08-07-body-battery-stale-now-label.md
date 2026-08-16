# 2026-08-07 — Body Battery chart's right-edge label stops falsely claiming "now"

**Domain:** readiness — v1.267.14, JS-only (no APK rebuild)

## The report

Q-108 (owner UI-bug batch): the owner asked whether a low-sample-count Body Battery reading was
accurate and suspected Home doesn't refresh — the chart appeared to span only ~2h despite waking
3+ hours ago.

## Two separate findings

1. **Working as intended.** Home's `body-battery` fetch only re-runs on mount, tab-revisit,
   pull-to-sync, or BLE-sync-settle — there's no polling. A long-open Home tab genuinely shows
   stale data until one of those triggers fires. Confirmed in code, not a bug.
2. **The actual bug.** `DayChart`'s right-edge axis label (`components/body-battery-card.tsx`) was
   a hardcoded literal `"now"` string — completely unrelated to the real last-sample timestamp
   (`t1`, already computed and used to scale the SVG). A stale card didn't just fail to update; it
   actively claimed to be current.

Checked against production (`claude_ro.sleep_sessions`) before touching code: the wake-time anchor
itself is correctly computed from a real recorded sleep-end (09:13 local that night) — no evidence
of a wake-time bug, only the label's false freshness claim. The existing "Limited data" /
low-sample disclaimer (Q-57) is a separate, intentional feature and untouched by this fix.

## The fix

```diff
-        <span>now</span>
+        <span>{fmtAest(t1)}</span>
```

Symmetric with the left-edge label, which already renders `fmtAest(t0)` — the wake-time anchor.
Deriving the right edge from the last series point the same way means the label is honest by
construction rather than by convention: it cannot claim "now" unless the last sample genuinely is
now. Deliberately avoided a client-side `Date.now()` freshness comparison (e.g. "show 'now' only if
the last sample is within N minutes") — the direct-timestamp approach needs no such threshold,
adds no state, and carries no hydration-mismatch risk between server and client render passes.

## Verification

`tsc --noEmit -p .` clean (only the pre-existing unrelated `voice-log-button.tsx` error). `eslint`
clean on the touched file. No existing test file covers this component (a two-line JSX
presentational change with no branching logic), so verification was visual.

The local seeded DB has no heart-rate samples for "today", so `hasData` is false and `DayChart`
never renders against a cold seed — the card shows its "no data yet" copy instead. Seeded 37
synthetic rows into `oura_heartrate` for the test user (5-minute cadence over the last 3 hours) to
exercise the real rendering path, confirmed via Playwright against `pnpm dev` that the axis now
shows two real derived clock times (e.g. "2:09pm" / "5:09pm") instead of a static "now", checked in
both light and dark themes, then deleted the synthetic rows (`DELETE FROM oura_heartrate WHERE
source = 'test'`) so the seed is unchanged going forward.

**Not exercised:** no on-device S25 verification — this is a pure presentational fix with no
native/safe-area/gesture involvement.

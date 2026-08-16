# Fix: revive zone-minutes + training-stress (both feature-dead) and the cardio correctness batch

**Source:** deep review `docs/reviews/2026-07-18-deep-app-review.md` §J/§C/§H/§E2/§G (J-8, J-9
adversarially verified REAL/high — J-8 empirically reproduced; merged zone-cache cluster
J-1/J-2/C-5/H-4; J-6; E2-9, E2-10; G-2). Branch: `fix/zone-training-stress-revival`.

## Problems

1. **J-8 (high):** `/api/zone-minutes` returns `days: []` on every real client call.
   `normalizeDateParam` returns the **slash form** (`lib/date-utils.ts:100`); the route
   (`app/api/zone-minutes/route.ts:22-24`) never converts back; `eachDay`
   (`lib/data/postgres/slices/oura.ts:451`) splits on `-` → NaN → zero iterations. The cache
   pre-select and `listBodyMetrics` also miss on slash-vs-dash ordering. The sole client
   (`components/health/time-in-zone-card.tsx:61`) always sends `from`/`to`, so the working dash
   default is never reached — Time-in-Zone has been dead since v1.164.0 and `daily_zone_minutes`
   has never been populated by real traffic. (Per-workout ZoneBreakdown is unaffected —
   client-side over hr readings.)
2. **J-9 (high):** `/api/training-stress` 500s whenever a clock anchor exists:
   slash date → `fromZonedTime('YYYY/MM/DDT00:00:00')` → Invalid Date on pinned date-fns-tz 3.2.0
   → NaN into a bigint SQL param → unhandled `Promise.all` rejection. Without an anchor it's
   permanently `gated` because the slash date can never match dash-keyed `oura_daily_derived`
   rows. **OTS is never persisted on any branch.** Fixing only `dateStrMidnightInTz` is not
   enough — the date itself must be dash-normalized.
3. **Zone-cache cluster (medium, latent until J-8 fixed):** `daily_zone_minutes` is
   compute-once-forever (`slices/oura.ts:480-497`, sole writer, no invalidation): past days
   freeze while the BLE rollup routinely delete-and-reinserts past-day HR
   (`adapter.ts:4603-4611`); the zone profile is derived from the query range and baked into the
   permanent cache (J-2/C-5/H-4); >180d recompute is already impossible once the HR prune fires.
4. **J-6 (medium, PLAUSIBLE):** OTS MET-series assembly drops timestamps — gaps compress the day
   and skew recency weights. Verify on real data shape and fix if real.
5. **E2-9 (medium):** fitness-test HRR1 is deterministically null for the resting-HRR protocol —
   HR sampling stops at `endMs` on TestActive unmount, so the `endMs+60s` recovery reading can
   never exist. Keep sampling ~90s past test end (or capture HRR from the live stream before
   teardown).
6. **E2-10 (medium):** "End test early" applies full-duration Ross/Cooper equations to truncated
   distance → corrupt VO₂max propagates to the fitness snapshot. Either scale to protocol rules or
   mark the test invalid/partial.
7. **G-2 (medium):** one out-of-band sample (bpm=0 pre-lock, RR artifact) Zod-rejects an entire
   strap `hr-ingest` batch. Filter/clamp per-sample server-side instead of failing the batch.

## Tasks (each independently shippable)

1. Normalize `normalizeDateParam` output to **dash form** (or add `normalizeDateParamIso`) and
   sweep its consumers for slash-form assumptions (grep every call site; the review found
   zone-minutes + training-stress broken, day-timeline/day-log/etc. handle it — re-verify each).
   Regression tests: route-level tests calling zone-minutes with `?from&to` dashed and
   training-stress with `?date` dashed asserting non-empty day iteration / no NaN.
2. Backfill `daily_zone_minutes` for stored HR history once the route works (bounded batches,
   reconcile-on-read already exists) and persist OTS for the current day on first good read.
3. Zone-cache correctness: recompute a cached day when the rollup rewrites HR in its window
   (invalidate-on-write from the rollup's delete-and-reinsert site), and key/annotate the cache
   with the zone profile used; document the >180d horizon.
4. HRR1 capture fix + end-early handling in the fitness-test flow.
5. hr-ingest per-sample tolerance.
6. Dev-server verification of every route touched; `pnpm test` green; on-device gates listed per
   task (strap batch + fitness-test flow are APK surfaces).

## Out of scope

Rollup cost/debounce (P4), AI visibility of zone/OTS signals (P3/F9 pointer).

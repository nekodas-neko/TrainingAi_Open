# 2026-07-27 — D2 Task 1: local-store Oura accessors (sandbox-completable slice)

Branch: `feat/d2-local-store-oura-accessors` · no version bump (no user-visible change)

## Why

D2 (native `oura_raw.db` + on-device rollup) is next per the master plan's D6 → D5 → D2 ordering,
now unblocked by D5's merge. D2 is split into tasks by the phase-1 plan
(`docs/superpowers/plans/2026-07-21-oura-raw-on-device-phase-1.md`); Task 1 (local calculated-form
tables + `LocalStore` accessors) is pure JS/server work, sandbox-buildable and CI-testable. Tasks 2
and 3 (native `oura_raw.db`, the local-commit cursor gate, and the WebView bridge) are genuinely
native Kotlin/Android changes — this sandbox has no Android SDK and its Gradle download is
proxy-blocked, so nothing here can compile-gate or verify Kotlin. Per the owner's confirmation
("yes that sounds like a good plan"), this PR ships only the safe, sandbox-completable Task 1 and
stops there — Tasks 2/3 are handed off with an explicit writeup rather than attempted blind.

## What shipped

- **`lib/local-store/types.ts`** — `LocalOuraBucket` and `LocalOuraHeartratePoint` interfaces.
- **`lib/local-store/index.ts`** — 8 new `LocalStore` interface methods: `getOuraDailySummary`/
  `upsertOuraDailySummary`, `getOuraDailyDerived`/`upsertOuraDailyDerived`, `getOuraBuckets`/
  `upsertOuraBucket`, `getOuraHeartrate`/`upsertOuraHeartrate`.
- **`lib/local-store/sqlite-backend.ts`** — full `SQLiteLocalStore` implementations. The
  `oura_daily_summary`/`oura_daily_derived` upserts match `applyDelta`'s column lists exactly
  (full-column upsert, `sync_status` passed through from the record rather than hardcoded — this
  deliberately does NOT reuse `applyDelta`'s pull-path clobber-guard, since these are local-write
  accessors, not pull-apply). `oura_bucket` keys on `(tier, bucket_start_ms)`, `oura_heartrate` keys
  on `ts_ms`.
- **Nothing calls these yet** — same inert-until-needed posture as the earlier F4 mark-synced arms
  (`markSleepSessionSynced` etc.), which also shipped ahead of their eventual caller.

## Verification

- `pnpm typecheck` clean, `node scripts/check-reconcile.js` OK (34 tables, 104 columns),
  `node scripts/check-push-mutations.js` OK, `pnpm lint` 0 errors (pre-existing warnings only).
- New `describe('D2 prep — Oura local read/write accessors (Phase-1 Task 1)', ...)` block in
  `lib/local-store/__tests__/sqlite-backend.test.ts` — 8 tests covering upsert SQL shape, get
  round-trips (including JSON-column and boolean 0/1 encoding for `oura_daily_derived`), and
  conflict-key targeting for the bucket/heartrate tables.
- Full suite: 272/272 test files passing. `pnpm build` clean.

## What was NOT exercised

- **Everything device-side.** These accessors have no caller, so there is nothing to exercise on an
  APK in this PR — `getLocalStore` returns null in the sandbox regardless. Device verification is
  meaningful once Tasks 2/3 give these a real write path.

## Next

D2 Tasks 2 and 3 need an owner session with Android Studio (or a working `./gradlew`) and the
physical S25 — see `docs/oura-ondevice-hybrid-implementer-progress.md`'s new "🔧 D2 native handoff"
section for the exact files, steps, and device-verification runbook. Do not start Task 4+ until
2/3 are device-verified and merged.

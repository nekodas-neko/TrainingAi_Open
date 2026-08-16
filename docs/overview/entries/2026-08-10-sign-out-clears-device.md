# 2026-08-10 — signing out left the previous account's data on the device (Q-172)

**Branch:** `fix/chat-signout-clears-cache` · **Domain:** `app-shell`, `platform` · **v1.277.3**

## What was filed, and what was actually there

Q-172: `components/chat.tsx` has two sign-out buttons posting a bare `<form action={signOut}>`,
clearing neither the cache nor the local store, while More → Profile clears both.

That was true. Reading the "correct" path before copying it found the bigger half.

**`clearLocalStoreData()` was a hand-written list of table names, and it had drifted to 27 of the
schema's 37 tables.** Ten were missing; seven of those hold real user data:

| table | what stayed behind |
|---|---|
| `oura_heartrate` | every heart-rate sample |
| `oura_daily_summary` / `_derived` / `oura_bucket` | sleep and readiness rollups |
| `prescribed_runs` | the user's running prescriptions |
| `meal_types` | user-defined meal types |
| `sync_outbox` | unsynced mutation payloads |

The other three are fine: `exercise_library` is the global catalogue, `api_cache` is cleared by
`clearAllCache()` in the same sequence, and `statements` was a false positive from my own grep — it
is the `RECONCILE_TABLES` variable, not a table.

So even the sign-out that "worked" left a previous account's health data on the device. This is the
same drift `RECONCILE_TABLES` was once missing 17 tables to, in the one function whose entire job is
not leaving data behind.

## Three changes

1. **`clearLocalStoreData()` reads `sqlite_master`** instead of a hand-written list, and clears
   everything except a two-entry keep-set with written reasons. A table added later is now wiped by
   default — the safe direction. Reading the live schema also covers tables left by a partial
   upgrade, which no static list can.
2. **`lib/sign-out.ts` is the only way to sign out.** All three buttons call it. One correct
   sequence copied to three call sites is one call site away from being wrong again, so there is
   nothing left to copy.
3. **`scripts/check-sign-out-clears-device.js`** (Custom Rules) fails on either way of getting it
   wrong: importing `signOut` from `@/app/actions` outside that file, or a `<form action={…}>` —
   which posts straight to the server action, so no client-side clear can run *however* the handler
   is written. Mutation-tested by restoring the original bug: it catches both.

## The clear did not hold, and measuring is the only reason I know

With all three buttons wired up, the real sign-out still left **4 of 17 cache keys behind** —
`body-metadata`, `next-session`, `weekly-stats`, `workout-data:meta`, none of which carry a user id.

`cachedFetch` calls already in flight resolve *after* `clearAllCache()` and re-seed. So a latch:
`disableCacheWrites()` is tripped **before** the clears and makes `setCached` a no-op; the sign-in
screen — the one place a new session provably begins — sweeps once more and releases it.

The sweep is not belt-and-braces theatre. With the latch alone, survivors from the pre-sign-out set
hit **0**, but two keys reappeared afterwards: a request that started before sign-out, landing after
the sign-in page mounted and re-enabled writes. The sweep closes that window too.

| | keys before | keys after | survived |
|---|---|---|---|
| all three buttons wired, no latch | 17 | 12 | **4** |
| + latch | 7 | 2 | 0 (but 2 new) |
| + sweep on sign-in mount | 24 | **0** | **0** |

## Verified

- Sign-out **still works**, which mattered more than the leak: redirects to `/sign-in`, and visiting
  `/health` afterwards bounces back to `/sign-in`, so the session is genuinely gone.
- 24 `ta_*` keys before, **0 after**, 0 survivors.
- The CI check catches the original bug when it is put back (both failure modes, named separately).
- `tsc --noEmit` clean · **435 files / 3456 tests** green · all 17 custom-rule scripts pass · eslint
  clean (the 8 warnings in `chat.tsx` are pre-existing, confirmed by stashing).
- `profile-tab.tsx` shrank 849 → 845 lines; its shrink-only baseline was ratcheted down to match.

**A harness lesson worth keeping:** one run reported cache numbers from a sign-out that *never
happened* — the button had not rendered yet and the click silently no-oped, so the "22 survivors"
it printed were meaningless. The harness now asserts the click landed before it trusts any
measurement.

## Not exercised

- **The APK, and this is the half that matters most here.** `clearLocalStoreData()` is a
  no-op on web (`isSQLiteAvailable()` is false), so **the local-store clear — the part that was
  missing seven tables of health data — was never actually run.** Everything measured above is the
  cache half. The `sqlite_master` query itself is standard SQLite and the keep-set is asserted by
  test, but the native path is unverified.
- Multi-account switching. There is one seeded user, so "account B does not see account A's data"
  is argued from the keys being gone, not observed directly.

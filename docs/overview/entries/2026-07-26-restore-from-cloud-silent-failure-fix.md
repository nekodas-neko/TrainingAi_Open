## 2026-07-26 — fix: "Restore from cloud" reported a failed pull as success

**Branch:** `claude/oura-ondevice-hybrid-5xycdr`.

### What happened
The owner tapped **Restore from cloud** (More → profile) without wiping local data first, as
a quick sanity check on the D1 restore driver shipped earlier (#758). The toast read
**"Restored 0 records from cloud"** — read as a possible bug rather than as "nothing to do".

### Investigation
Re-created the exact server-side query (`getSyncDelta(userId, epoch, windowDays: null)`) against
the local seeded dev DB: it correctly returned full history (14 body-metrics rows, 9 workout
sessions, 7 sleep sessions, 7 mood logs) for the epoch-since / no-window-clamp restore path — so
the server-side `mode=restore` logic is sound, ruling out a `getSyncDelta` regression.

Reading `restoreFromCloud` (`lib/local-store/sync-engine.ts`) surfaced the real bug: when the
first `pullDelta` page fails (dead network, expired session, rate limit — anything that makes the
`fetch` non-ok), `pullDelta` returns `null`, and the restore loop's `if (!res) break;` silently
discarded that signal and returned `{ synced: 0 }` — byte-identical to the shape returned when the
pull genuinely succeeded and found nothing new. The UI (`components/more/profile-tab.tsx`) has no
way to tell the two apart, so a transient failure and "you're already fully synced" both show the
same green success toast. An existing unit test even encoded this
(`'stops (resumable) when a pull fails, without looping forever'` asserted `{ synced: 0 }` as the
expected outcome for a failed pull) — this was a known gap, not a new regression.

### Fix
`restoreFromCloud` now returns `{ synced, failed: boolean }`. A page-0 (or any-page) failure sets
`failed: true` immediately rather than silently completing the loop. `handleRestore` branches on
it: `failed` shows an error toast ("Restore paused after N records — connection issue. Tap
Restore again to continue." or "Restore failed — check your connection and try again." if zero
progress was made), matching CLAUDE.md's "no silent fallbacks on failure paths" rule. The
underlying resumable-cursor mechanism (each page persists its own cursor via `setLastSyncAt`) is
unchanged — a retry after a `failed:true` toast correctly resumes rather than restarting.

Updated the existing unit test's name/assertion to match the corrected contract; added no new
test file, extended the existing `restoreFromCloud` describe block in
`lib/local-store/__tests__/sync-engine.test.ts`.

### Verification
- `npx tsc --noEmit` — clean (2 pre-existing `onnxruntime-web` errors only, unrelated).
- `npx eslint lib/local-store/sync-engine.ts components/more/profile-tab.tsx lib/local-store/__tests__/sync-engine.test.ts` — clean (1 pre-existing unrelated warning).
- `npx vitest run lib/local-store/__tests__/sync-engine.test.ts` — 10/10 passing.
- `node scripts/check-push-mutations.js`, `node scripts/check-reconcile.js` — both OK.
- Server-side `getSyncDelta` restore-path logic independently verified against the local seeded
  Postgres (see Investigation above).
- **Not verified on-device.** The owner's original "0 records" report was on the real APK; this
  fix changes only the failure-signaling path (UI branch + return shape), not the pull mechanics
  themselves, so no new native/Capacitor surface is touched — but the owner should re-run
  **Restore from cloud** once this deploys to confirm it now reports a non-zero count (their
  history is substantial: months of body metrics, 14+ backfilled step days, sleep, workouts).

### Not done in this PR (unchanged from prior status)
D1's F4 mark-synced arms (`oura_daily_summary`, `oura_daily_derived`, `sleep_session`,
`oura_daily` push-confirm arms in `sync-engine.ts`) are still the next confirmed-missing D1 task —
this PR didn't touch them.

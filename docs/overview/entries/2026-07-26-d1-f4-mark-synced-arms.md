## 2026-07-26 — D1: F4 mark-synced arms for the Oura push domains

**Branch:** `claude/oura-ondevice-hybrid-5xycdr`.

### What shipped
`pushMutations`'s push-confirm loop (`lib/local-store/sync-engine.ts`) flips a domain's local rows
back to `sync_status='synced'` once the server confirms the mutation. Every domain had an arm
except three Oura ones that were added to `SYNCED_MUTATION_DOMAINS` earlier in D1 but never wired
up: `sleep_session`, `oura_daily_summary`, `oura_daily_derived`.

Added three narrow methods to `LocalStore` (interface in `lib/local-store/index.ts`, implementation
in `lib/local-store/sqlite-backend.ts`):
- `markSleepSessionSynced(id)` → `UPDATE sleep_sessions SET sync_status='synced' WHERE id=?`
- `markOuraDailySummarySynced(day)` → same, keyed by `day`
- `markOuraDailyDerivedSynced(day)` → same, keyed by `day`

These are deliberately **not** full upserts (unlike `upsertBodyMetric`/`upsertMoodLog` etc., which
re-save the whole row with `syncStatus` flipped) — they mirror `markSessionSynced`'s existing
narrow-UPDATE-by-key pattern instead. Reason: `sleep_session`/`oura_daily_summary`/
`oura_daily_derived` have no local single-row *write* path yet at all — that's D2's on-device
rollup writer, not yet built. Inventing a full upsert now would mean guessing at column
sets/semantics D2 hasn't designed yet (the exact kind of premature, disconnected-from-the-real-caller
work CLAUDE.md's "no half-finished implementations" / "don't design for hypothetical requirements"
rules warn about). A narrow flag-flip needs no such guess — it only touches `sync_status`, and any
future writer will still need exactly this operation in exactly this shape.

Wired into the confirm loop: `sleep_session` keys off `m.payload.id` (the local row's own PK, same
convention as `workout_log`/`activity_logs`); `oura_daily_summary`/`oura_daily_derived` key off
`m.date` (matches how their server push branches already key by date).

### Correcting a doc inaccuracy found along the way
The backlog/handoff docs described this as "the four Oura push domains (`oura_daily_summary`,
`oura_daily_derived`, `sleep_session`, `oura_daily`)". Grepped `lib/sync/mutation-schema.ts`:
`oura_daily` was never actually added to `SYNCED_MUTATION_DOMAINS` — no push branch, no envelope
entry. A mark-synced arm for it would be unreachable dead code (the `PendingMutation['domain']`
type can't produce that value). Registering `oura_daily` as a real push domain — enum entry, server
push branch, local write path — is D2 scope, not F4's; corrected in
`docs/implementation-backlog.md` and `docs/oura-ondevice-hybrid-implementer-progress.md` in this PR
rather than building a dead arm just to match the old doc's count.

### Verification
- `npx tsc --noEmit` — clean (2 pre-existing `onnxruntime-web` errors only, unrelated).
- `npx eslint lib/local-store/sync-engine.ts lib/local-store/sqlite-backend.ts lib/local-store/index.ts lib/local-store/__tests__/sync-engine.test.ts` — clean.
- `npx vitest run lib/local-store lib/sync` — 64/64 passing, including two new tests asserting the
  confirm loop calls the right mark-synced method with the right key for each domain, and the
  existing `queueMutation` domain-coverage source-scan test (unaffected — these arms compare
  `m.domain ===`, not `domain: '...'` literals, so the scan doesn't false-positive on them).
- `node scripts/check-push-mutations.js`, `node scripts/check-reconcile.js` — both OK.
- **Not device-verified** — and can't meaningfully be yet: nothing queues a mutation for these three
  domains until D2's on-device rollup writer exists, so this is inert on the real APK today. That's
  expected, not a gap; it's exactly what the "ship it now while cheap" framing in the backlog note
  meant.

### Status after this PR
D1 is now fully done except B3 (Track-B outbox push side) and B5 (concurrent-pool load test), both
correctly D2-blocked/low-priority. Remaining Oura client work — local write helpers
(`upsertOuraDaily`/sleep/summary/derived), the on-device rollup writer, `oura_daily`'s push-domain
registration — is D2, which needs the owner's APK rebuild + S25 device.

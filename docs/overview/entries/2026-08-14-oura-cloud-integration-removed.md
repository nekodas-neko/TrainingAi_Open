# 2026-08-14 — the Oura Cloud integration is gone (Q-224)

**Branch:** `claude/trainingai-backlog-v0abea`

Owner, 2026-08-13: *"yes get rid of oura cloud references we dont use it."* The automatic calls went
that day — the workout-completion HR pull and the app-open sync. This is the rest: the OAuth/PAT
flow, the sync route, the webhook receiver, the HTTP client, the token cipher, the token storage,
and every button that fired one.

**Deleted:** `app/api/oura/{connect,callback,sync,token,webhook}`, `lib/oura/{client,get-token,
hr-sync,oauth-state,sync-throttle,token-crypto,webhook-signature}.ts`, six test files, seven
repository methods (`getOuraPat` · `saveOuraPat` · `deleteOuraPat` · `saveOuraOAuthTokens` ·
`getOuraTokenRow` · `getUserIdByOuraUserId` · `saveWebhookSigningKey`) plus `getLastOuraSyncedAt`,
two orphaned writers (`upsertOuraTags`, `upsertOuraWorkouts`), the `oura-token` cache group, and 22
of the 23 interfaces in `lib/oura/types.ts`.

**Kept, deliberately:** every row of historical Cloud data — `oura_daily`, `oura_daily_summary`,
`oura_daily_derived` and the pre-re-key rows in `sleep_sessions`/`body_metrics` are the owner's
health history, read by health-trends, the day timeline and the sync engine. `oura_tokens` stays
too: dropping it is a data-losing migration that buys nothing. And `lib/oura/cloud-freshness.ts`
stays — see below.

## The backlog entry's premises did not survive reading, five times

The entry was written from a grep. Each of these would have been a live regression:

1. **`lib/oura/cloud-freshness.ts` was listed for deletion.** It makes no network call. It holds
   `OURA_CLOUD_REKEY_DATE`, the single constant two live readiness paths use to know that a
   Cloud-dated value is a frozen snapshot. Deleting it breaks the interpretation of the data the
   entry insists on keeping.
2. **`/api/oura/hr-window` was listed for deletion.** Three activity components read it. Only its
   on-demand Cloud backfill was Cloud; the route itself reads `oura_heartrate`. The block went, the
   route stayed.
3. **`/api/oura/hr-sync` was listed for deletion.** It stopped being a Cloud route on 2026-08-13,
   when the pull was removed from `syncAndAttributeSessionHr`. It is now BLE *attribution* behind an
   `/oura/`-prefixed URL, and the Health tab calls it before reading session HR.
4. **`/api/oura/stats` gates the Health tab's whole Ring section on `connected`** — which meant
   "an `oura_tokens` row exists". Removing token storage would have flipped it permanently false and
   made that section return `null`. Nothing would have thrown; the section would just have stopped
   rendering, on a screen no sandbox test opens. `connected` is a BLE fact now, and
   `stats/__tests__/connected-is-a-ble-fact.test.ts` pins it in both directions.
5. **`upsertOuraWorkouts` had exactly one caller — the deleted sync route.** See below.

The entry did get the one trap it flagged exactly right: `components/more/oura-section.tsx` is mixed,
and deleting it would have taken the live BLE ring battery with it.

## What the More card is now

Surgery, not deletion. It was half Cloud — `GET /api/oura/token` supplied "connected", ring
colour/size/firmware and a battery reading, plus Connect / Sync Now / Disconnect rows. All of that is
gone and nothing true was lost: the battery had been frozen since the re-key (Q-205), the sync button
pulled nothing, and "connected" described a dead credential rather than a ring. Colour/size/firmware
were the only genuinely Cloud-only facts, and the firmware version is pinned on purpose so it never
changes. What is left reads `/api/oura-ble/battery-latest` and `/api/oura-ble/freshness`: battery,
last-seen age, and a Live badge that now means the ring is actually live.

The Health tab's "Sync" button and its ≤1×/6h auto-sync effect are gone the same way, along with the
BLE-freshness gate in both pull-to-sync handlers — that gate existed only to decide whether to fire a
Cloud sync, so with the sync gone it had nothing left to decide.

## A dead feature this surfaced (filed as Q-231)

`upsertOuraWorkouts` lost its last caller, which raised the question of what still fills
`oura_workouts`. Nothing does. Measured in production rather than assumed: **13 rows, newest
`day = 2026-07-05`**, two days before the re-key. `getOuraWorkouts({ unreviewed: true })` looks back
30 days, so the "Exercise detected" card ran out of anything to show around **2026-08-04** — ten days
before this PR touched it. This change did not break the card; it made an already-dead pipeline
visible. `day-timeline`'s walk filter reads the same table and has lost Oura-detected walks over the
same period. Filed as Q-231 rather than fixed here, because whether detection should come from the
BLE classifier is a design question that overlaps Q-222.

## Verified

Full suite green — **461 files, 3,809 tests**, zero failures. `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33 (the CLAUDE.md path check caught three dead paths in the Oura section and
was the reason that section got rewritten rather than patched).

**Two new guards, both mutation-verified:**

- `lib/oura/__tests__/no-cloud-calls.test.ts` sweeps all 1,000+ source files for the Cloud host, the
  five deleted routes and the two deleted libs, and asserts the repository exposes no token storage.
  Re-adding `fetch('https://api.ouraring.com/…')` and `fetch('/api/oura/sync')` to an unrelated
  component fails 2 cases; re-adding `getOuraPat` to the repository interface fails a third. It
  skips whole-line comments on purpose — the history of *why* the Cloud went away is worth keeping
  next to the code it used to live in, and a string literal on a code line is still matched, which
  is where a real call would be. It also asserts the sweep found >1,000 files, so a broken walk
  cannot make every other case pass vacuously.
- `app/api/oura/stats/__tests__/connected-is-a-ble-fact.test.ts` — a user with BLE samples and no
  token is connected; a user with neither is not. Reverting `connected` to a credential gate fails
  the first.

**Not exercised: the S25, and this change is unusually device-shaped.** Both rewritten surfaces —
More → Profile's Integrations card and the Health tab's Ring section — are canonical-runtime screens
that do not render in this sandbox, and the Ring section's visibility now depends on a query against
`oura_raw_samples` rather than on a token row. Recorded as ⚠️ NOT device-verified in
`projectOverview.md`; the check is "open More → Profile and the Health tab and confirm the ring
still reports battery and a last-seen time".

`TOKEN_ENC_KEY` is now read by nothing — the optional owner action left over from Q-217 is moot and
has been struck.

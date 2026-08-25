# 2026-08-25 — delete the superseded per-table vacuum route (Q-315 leftover)

**Branch:** `docs/admin-maintenance-buttons` · **Lane A** · deletes `app/api/oura-ble/samples/vacuum/`.

Q-315's own entry named this and assigned it: *"`app/api/oura-ble/samples/vacuum/route.ts` now has no
caller. Deleting it is `app/api/**`, Lane A's, and was not done as a side effect of wiring a button."*
Done.

## Why it is safe

- **No caller.** The only remaining mention anywhere in the tree is a comment inside
  `db-footprint-card.tsx` saying *"the generalised route, not `/api/oura-ble/samples/vacuum`"* — a
  pointer away from it, not a use of it. No test referenced it.
- **No lost coverage.** `VACUUM_FULL_TABLES` (`lib/data/postgres/slices/oura.ts:1618`) carries
  **both** `oura_raw_samples` *and* `error_events`, so `/api/admin/vacuum` does everything the
  deleted route did and more. Checked before deleting rather than assumed.

## The finding worth keeping: the buttons already existed

This session went looking for these controls on the owner's request for *"an admin ui button"* for
maintenance tasks, and found they had **already shipped** — twice, by Lane B, in the last two days:

- **Q-316** — the frame packer, 2026-08-24 (v1.363.3).
- **Q-315** — the vacuum, with a table picker fed by the route's own `GET` so the allowlist cannot
  drift from the client, 2026-08-25.

Both live in `db-footprint-card.tsx`'s ① Data section on `/admin/oura-ble`.

**What is actually missing is discoverability, not capability.** That page is reached through
**More → Settings → Developer → "Oura BLE debug"**, so a general-purpose *database* maintenance
control — `error_events` is a platform table with nothing to do with the ring — sits behind a row
labelled for Oura. `/admin` itself has five tabs (users, invites, exercises, activities, feedback)
and no maintenance tab at all.

That is **Q-531** ("Q-234 moved the device consoles out of /admin, and in use that made them worse"),
already filed and already owner-gated, and it is Lane B's by the path rule — `app/admin/` and
`components/admin/` with no engine half, since the routes exist and are generalised. Recorded here
rather than re-filed.

## Verified

- `tsc --noEmit` clean. (A first run reported a missing module for the deleted route — that was a
  stale `.next/types/validator.ts` build artifact, gitignored; clean after clearing it. Worth knowing
  before anyone treats it as a real break.)
- **4,821 tests pass** · `pnpm check:rules` **Ran 58 of 58**.

## Not exercised

The reclaim itself has not been run — that is one owner button-press on the S25 or a desktop browser,
and it is the only thing Q-315 still waits on. `error_events` was **49 MB against 28 live rows** when
measured earlier in this session; production could not be re-queried at write time (the sandbox's
outbound proxy returned 502), so that figure is from ~15:30 rather than now.

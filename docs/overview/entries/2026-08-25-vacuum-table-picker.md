# 2026-08-25 — the vacuum button can reach the table that needs it (Q-315)

**Branch:** `feat/vacuum-table-picker` · **Lane B** · no schema, no route, no APK.

`error_events` holds **4 live rows in 49 MB** in production — 6% of the whole database, dead tuples
and TOAST left behind after Q-539 fixed the write path that had written 5,771 rows of near-identical
boilerplate. Q-539 stopped the bleeding; nothing reclaimed the space.

Q-315 sat as `Gate: owner` — *"what is left is a press"* — which was true and incomplete. It was
re-scoped to Lane B on 2026-08-24 with the real finding: **nothing in the app could make that press.**

Re-verified against `main` before writing anything, and all three still held:

- `app/api/admin/vacuum/route.ts` exists, generalised, with `error_events` in `VACUUM_FULL_TABLES`
  and a `GET` that returns the allowlist as `{table, what}[]` for exactly this purpose — **and no
  caller anywhere.**
- The one vacuum control in the app (`db-footprint-card.tsx`) still posted to the *old*
  `/api/oura-ble/samples/vacuum`, which only ever touches `oura_raw_samples`.
- The route is session-only (no bearer path, unlike `ADMIN_EXPORT_SECRET`/`ADMIN_SNAPSHOT_SECRET`),
  so there was no way to reach `error_events` from anywhere at all.

## What shipped

The control gained a table picker, **fed by the route's own `GET`** rather than a local copy of the
allowlist — adding a table server-side puts it in the picker with no client change, which is what
that `GET` was built for. It posts to `/api/admin/vacuum` with the chosen table.

The result line now reports `liveRows` beside `beforeBytes`, because that pair is what distinguishes
**pure bloat** from a table that is genuinely large — and that distinction is the whole reason Q-315
is a one-off reclaim rather than a recurring chore.

The confirm copy is per-table now. The old text promised *"body_hex and all rows are preserved"*,
which is true of `oura_raw_samples` and meaningless for `error_events`; it names the selected table
and the `ACCESS EXCLUSIVE` lock instead.

## Verified

Driven in a browser at desktop width against local Postgres, signed in as the seeded admin:

- Picker renders both allowlist entries — `oura_raw_samples — raw BLE frames`,
  `error_events — server error log` — from the route, not a hardcoded list.
- Selecting `error_events` → confirm reads *"Run VACUUM FULL on error_events…"* →
  `POST /api/admin/vacuum` **200**, `{"table":"error_events","liveRows":3,"beforeBytes":49152,
  "afterBytes":49152,"reclaimedBytes":0,"ms":5}` → the card renders
  *"error_events: reclaimed 0 B (48 KB → 48 KB, 3 live rows) in 0.0s"*.

**Zero reclaimed is the correct answer here and is not evidence the fix works on the real case.** The
local `error_events` is 48 KB with no bloat to remove; production's is 49 MB against 4 rows. What is
proven is the path — picker → allowlist → route → repo → rendered result. What is not proven is a
large reclaim, which cannot be reproduced without the bloat.

`tsc --noEmit` clean · eslint unchanged (1 pre-existing warning before and after) ·
`pnpm check:rules` **Ran 56 of 56**.

## Left behind deliberately

`app/api/oura-ble/samples/vacuum/route.ts` now has **no caller**. Deleting it is `app/api/**`, which
is Lane A's, and removing a working admin route is not something to do as a side effect of wiring a
button. Noted rather than done.

## Not exercised

- **The reclaim itself, on production data.** That is the owner's press, and it is what Q-315 has
  always been for. The card is on `/admin/oura-ble`, which Q-544 moved above the native-gated
  `OuraBleDebug` precisely so it renders on a desktop — the client that can actually hold the lock.
- **The S25 APK.** A `<select>` at phone width is untested here; the card is an admin surface driven
  from a desktop by design, but the page is still reachable on the device. `Gate: device`.
- **A VACUUM FULL that outruns the statement timeout.** The slice lifts both timeouts for the call,
  and that path was not exercised against a table large enough to need it.

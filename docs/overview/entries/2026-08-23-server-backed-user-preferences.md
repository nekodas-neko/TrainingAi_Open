# 2026-08-23 — Preferences got a server home; nothing reads it yet (Q-392, engine half)

**Branch:** `feat/server-backed-user-preferences` · **Lane A** · no user-visible change

The owner reinstalls, and every reinstall reset the app: *"when i do a new install or open on
computer - it loses all the saved preferences."* The customised surface is exactly what went — the
score-ring style, the three quick-log tiles, card colours, which widgets appear at all. All of it
lived in `localStorage` and nowhere else.

This PR builds the server side. **It changes nothing the owner can see**, because no read site
calls it yet — that half is `components/**` and `app/**`, which is Lane B's, and the backlog entry
was re-scoped to it rather than closed.

## What shipped

| piece | where |
|---|---|
| `users.preferences` JSONB, `NOT NULL DEFAULT '{}'` | migration `206_user_preferences.sql` |
| Shape, device-key map, not-synced list, merge | `packages/shared/src/user/preferences.ts` |
| `getUserPreferences` / `updateUserPreferences` | `lib/data/repository.ts`, `lib/data/postgres/adapter.ts` |
| `GET` / `PATCH /api/user/preferences` | `app/api/user/preferences/route.ts` |

## One blob, not a column each

Preferences are an open-ended set that nothing queries — no report asks which users chose ring
style 12. A column each means a migration per new toggle, and this repo's migration discipline
makes each one a real cost. Half the list is arrays and maps anyway, so it would be JSON inside a
column either way; `body_metrics.source_map` and `oura_daily.contributors` are the same shape
already. The trade accepted is no DB-level typing and no per-key query. Reversing it in either
direction is a non-destructive migration that reads the blob.

## The merge is the feature, and it is locked

`PATCH` merges rather than replaces: a device that only knows the keys it uses must not blank the
ones another device set. An explicit `null` clears a key, so "forget this" is expressible without
sending the whole bag.

The read-modify-write runs under `SELECT … FOR UPDATE`. **This is not defensive padding — the
unlocked version demonstrably loses data.** Staged deterministically rather than raced: another
device's write commits between this one's read and its write. MVCC does not block the read, so it
sees the pre-write bag; the `UPDATE` then queues behind the other transaction and finally writes a
merge built from a bag that is already stale. With the lock removed, that test fails with the other
device's key missing. It is the exact failure the feature exists to remove, and it would have
shipped looking correct on whichever device wrote last.

## Verified

- **9 DB-backed merge tests**, mutation-checked three ways: replacing the merge with a replace
  fails 5 of them, dropping the `null` branch fails 1, removing the row lock fails the interleaving
  test. Each mutation was applied, run, and reverted.
- **17 schema tests** — `.strict()` on both schemas, because a typo'd key in a free-form bag is
  invisible: it stores fine, reads as absent, and the surface quietly falls back to its default
  while the server insists it saved.
- **Two signed-in sessions against `pnpm dev`**, each PATCHing its own keys: both see the union,
  and a `null` from one clears the key for both. 401 unauthenticated, 400 on an unknown key, 400 on
  a wrong type, 400 on bad JSON, 413 over 32 KB, `Cache-Control: private, no-store` on both verbs.
- Full suite 547 files / 4,532 tests; `pnpm check:rules` 52 of 52.

**Not exercised:** the APK. Nothing here is native, offline-first, safe-area or gesture work — it
is one column, one route and no client read site — so the device gate does not apply. It will apply
to Lane B's half, which touches first paint.

## What is left, and what deliberately is not

`PREFERENCE_STORAGE` maps each preference to its `localStorage` key **and its encoding**, which is
the part that bites: `ta_ss_widgets` is JSON, `ta_weight_lookback` is a bare number, and the
reminder toggles are `String(boolean)` compared against the literal `'false'`. A test asserts the
map covers every schema key, so Lane B's wiring is mechanical rather than transcribed.

`DEVICE_LOCAL_PREFERENCES` names what will **not** sync, with a reason each: push enablement, the
two Android status-bar chip toggles, the ring and scale/HR BLE pairings, and light/dark. Listed
rather than merely absent, because from a second device "it didn't sync" and "it isn't meant to"
look identical — Q-392 asked for that list by name.

`ta_background_settings` is the one that is not a plain key: it is a Zustand `persist` store, so
the value there is the `{ state, version }` envelope. The schema types it as opaque on purpose —
the shape belongs to that store, and a second definition here would drift.

## Also corrected

`docs/module-map.md` carried its own copy of "next free migration number = **113**" while the
directory head was 206. A hand-maintained duplicate of a monotonically increasing number does
exactly that, so the row now points at the backlog pointer, which CI verifies against the
directory.

# BF-192 — account deletion, and the delete path that already throws

**Branch:** `feat/bf-192-account-deletion` · docs-only · BugFix intake

Owner: *"there is no option for users to delete their account and their data. This is a requirement
for apple store so lets add this in next."*

**The one delete path that exists is broken, and it was reproduced rather than inferred.**
`deleteUser` (`adapter.ts:699`) is a bare `DELETE FROM users`, reached only from `/api/admin/users`.
Against the local database with all migrations applied, deleting a user who has created a single
custom exercise fails:

```
ERROR: update or delete on table "users" violates foreign key constraint
       "exercise_library_created_by_fkey" on table "exercise_library"
```

A user-facing button wired to today's code would inherit that and fail in the one flow that must not.

**What a `users` delete reaches.** 99 base tables, 72 with `user_id`. Of the foreign keys pointing at
`users`: **72 CASCADE**, **2 SET NULL** (`ai_call_log`, `error_events` — rows survive anonymised),
**1 NO ACTION** (`exercise_library.created_by` — blocks the delete). The 24 other tables with no such
key are reference/ops data or child tables that cascade through a parent; `db_query_log` is the one
worth attention, since its `sql_text` can carry the user's data in the query body.

**The design point: do not write a new list of tables.** `lib/export/export-map.ts` already
enumerates every table holding the user's data and is exhaustive by construction — each base table is
either `EXPORTED` with a scope or `EXCLUDED` with a reason, and `check-export-coverage.js` fails CI
when a new table is in neither. Its own header records why that matters: the hand-written version
covered **26 of 82 tables and presented as complete** (Q-288). An export that misses tables is bad; a
deletion that misses them is a false compliance claim nothing in the product would reveal.

One semantic inverts. `SOFT_DELETED` exists so an export does not resurrect rows the user deleted —
it filters them out. A deletion must take them. Reusing the map without flipping that predicate is
the most likely way this ships looking complete and is not.

The device half needs nothing new: `signOutAndClearDevice` already disables cache writes, clears the
local store and cache, then signs out, in that order, and `check-sign-out-clears-device.js` enforces
it. Checked because it would be unrecoverable: that wipe does **not** touch the Oura ring's BLE key,
which lives in native SharedPreferences and is reached only by the admin screen's `clearKey()`.

Filed `Lane: A` — it needs a migration (`created_by` → `SET NULL`), and migrations are Lane A's.
Three policy choices went to **BF-193** (`Lane: O`) rather than sitting in the body: what happens to
the two anonymised log tables and `db_query_log`, whether deletion should clear the ring key
(recommended no — wrongly keeping it is a tap, wrongly clearing it is a factory reset), and whether
deletion is immediate or gets a grace period (recommended immediate — this repo has no cron layer).

Two things stated carefully rather than confidently: the store requirement is described without
quoting a guideline number from memory, and **Google Play carries an equivalent requirement**, which
matters because the canonical runtime is the Android APK and there is no iOS build in this repo yet.

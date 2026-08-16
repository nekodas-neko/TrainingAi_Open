# 2026-08-02 — a second person wearing a ring would have silently lost their sleep

**Branch:** `fix/ble-sleep-id-user-scope` · **Version:** 1.250.7 · **Migration 166** · Run-list
item 12 of the [batch queue drain](../../handoff-2026-08-02-platform-batch-queue-drain.md).

## What was wrong

The BLE rollup derives `sleep_sessions.oura_id` as `` `ble:<startDs>` `` from the ring's own
counter — **no user component** — while the column carried a **globally** unique constraint. Real
Oura Cloud ids are globally unique so the constraint suited them; the synthetic BLE ids are not.

The failure mode is quiet, which is what makes it worth fixing before it can happen. The rollup's
insert arbitrates on `(user_id, sleep_start)`, which does not cover `oura_id`, so the second user's
night hits an unhandled unique violation — and `aggregateOuraRawSamples` files write errors into its
returned `stepErrors` rather than throwing. Their sleep data would **stop landing with nothing
surfaced anywhere**.

Latent while one person wears a ring. Production holds several real accounts, and the owner has
said more phones and more users are expected, so this is exposure waiting on one event.

It was already happening between *test users*: four rollup tests sharing a ds base all derived
`ble:1000000`, which was the long-running `oura-ble-sleep-window-union` CI flake (Q-21, worked
around 2026-07-29 by separating the test bases). The product-side mismatch was left untouched then.

## What shipped

**Migration 166** drops the global constraint and adds `UNIQUE (user_id, oura_id) WHERE oura_id IS
NOT NULL`. The id identifies a night *for a user*, so that is what the constraint now says.

Safe by construction: the old constraint was strictly stronger, so no duplicate `(user_id, oura_id)`
pair can already exist and the widening cannot fail on existing data. No read path changes either —
nothing in the codebase queries `sleep_sessions` by `oura_id`; it is a dedup guard, never a lookup
key. The Drizzle schema drops its `.unique()` to match.

The index is partial because most nights have no `oura_id` at all (manual and Health Connect
sleep). Postgres treats NULLs as distinct regardless, so this is about not indexing rows that can
never collide.

## The alternative, and why not

The other option was scoping the id itself — `` `ble:<userId>:<ds>` ``. Rejected: it leaves every
existing row on the old form until something re-stamps them, and it fixes only this one id scheme
rather than the constraint that is wrong for *any* synthetic id.

## Verified

Three DB-backed assertions: two users can now hold the same ring-derived id; a duplicate id within
one user is still rejected; and rows without an id are unaffected.

**Checked against the old constraint.** Restoring the global `UNIQUE (oura_id)` fails the first
assertion — the exact collision described above — and the migration's version passes. Migration
applied and re-applied against the local database; `\d sleep_sessions` confirms the swap.

Full suite green, lint and typecheck clean, custom rules pass.

## Adjacent, not touched

`oura_tags.oura_id` (migration 106) is also `NOT NULL UNIQUE` globally. Those are real Oura Cloud
tag ids, which genuinely are globally unique, so the constraint is correct there. Noted so the next
person greping for this pattern doesn't "fix" it.

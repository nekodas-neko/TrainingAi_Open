# Q-44 Phase 3 — rename the vendor-named tables (`oura_daily` → `sensor_daily`)

**Status:** plan only. Nothing here is implemented.
**Owner decision, 2026-08-04:** *"I want the end goal of moving from your example of oura_daily ->
sensor_daily."* So this is a goal, not an option — but the backlog is also right that it *"may be
partly wrong to do at all"* for one table. This plan separates those.

## Why it is worth doing

The ring is no longer read through Oura's cloud — it is read directly over BLE onto our own key, and
the architecture is explicitly heading device-agnostic
([`docs/device-agnostic-source-architecture.md`](../../device-agnostic-source-architecture.md)).
Tables named after one vendor describe a coupling that no longer exists, and every new source
(scale, chest strap, Health Connect) has to either pretend to be Oura or grow a parallel table. It
also matters ahead of the public repo: `oura_*` throughout the schema reads as an Oura client.

## Why it is not a search-and-replace

- **794,659 rows in `oura_raw_samples`** alone (production, 2026-08-04).
- **~2,813 repo-wide references** across schema, adapter, slices, sync engine, migrations, tests and
  the `claude_ro` read-only view layer.
- The rename touches the **sync contract**: `lib/local-store/sync-engine.ts` dispatches on domain
  *strings* (`m.domain === 'oura_daily_summary'`), and **an installed APK keeps sending the old
  strings until the owner reinstalls**. This is the part a schema-only plan would miss.

## The 13 tables, and what each should become

| current | proposed | note |
|---|---|---|
| `oura_daily` | `sensor_daily` | vendor-neutral daily rollup |
| `oura_daily_summary` | `sensor_daily_summary` | |
| `oura_daily_derived` | `sensor_daily_derived` | |
| `oura_heartrate` | `sensor_heartrate` | already fed by the strap too |
| `oura_workouts` | `sensor_workouts` | |
| `oura_tags` | `sensor_tags` | |
| `oura_bucket` | `sensor_bucket` | |
| `oura_daytime_hrv_model` | `daytime_hrv_model` | not source-specific at all |
| `oura_accel_chunks` | `sensor_accel_chunks` | |
| `oura_ble_battery_poll` | `ring_battery_poll` | ring-specific by nature |
| `oura_ble_clock_anchors` | `ring_clock_anchors` | ring-specific by nature |
| `oura_tokens` | **keep** | these really are Oura Cloud OAuth/PAT credentials |
| `oura_raw_samples` | **keep** | see below |

**`oura_raw_samples` should keep its name, and this is the one place the backlog's doubt is right.**
It holds the reverse-engineered BLE frames of *that specific ring*, decoded by a protocol pinned to
*that ring's firmware*. `sensor_raw_samples` would imply a shared frame format that does not exist —
a Polar H10 frame and an Oura frame have nothing in common. Renaming it would make the schema
*less* honest, not more. If a second raw-frame source ever lands it gets its own table.

Same argument, shorter, for `oura_tokens`: those are credentials for Oura's cloud API.

## Sequencing — three PRs, not one

### PR 1 — rename the tables, keep the old names working

One migration (next free number; **claim it against the directory *and* any open PR** — the tree
already carries two collided pairs):

```sql
ALTER TABLE oura_daily RENAME TO sensor_daily;
CREATE VIEW oura_daily AS SELECT * FROM sensor_daily;
-- …repeat per table…
```

`ALTER TABLE … RENAME` is a catalogue-only change — instant even on 794k rows, no data copy. The
compatibility **view** is what makes this safe: Railway can have an old container and a new one
overlapping, and a simple `SELECT *` view is updatable in Postgres, so old code keeps reading *and*
writing through it. Without the view this is a hard cutover with a window where one of the two
containers is querying a table that no longer exists.

Also in PR 1, because they break the moment the table moves:

- **Re-run the `claude_ro` generator into a NEW migration number** —
  `CLAUDE_RO_OWNER_USER_ID=<id> node scripts/generate-claude-ro-views.js`. Never edit an applied
  migration: `ensureSchema` tracks by filename, so an edited one is skipped forever and the change
  silently never lands. The schema is default-deny, so a renamed table is unreadable until its view
  exists, and a DB-backed test fails if the counts diverge.
- **Indexes and constraints keep their old names** after a table rename. Cosmetic, but rename them
  in the same migration or the next reader will think the rename was half-done.

### PR 2 — move the code onto the new names

Drizzle table consts (`ouraDaily` → `sensorDaily`), adapter, slices, tests. Mechanical, and the
compatibility views mean it can land separately without a coordinated deploy.

**The sync-domain strings are the trap.** `sync-engine.ts` dispatches on `m.domain ===
'oura_daily_summary'`, and the outbox in an **already-installed APK** keeps emitting the old string
until the owner reinstalls. So the push/pull handlers must **accept both** the old and new domain
strings for at least one APK cycle:

```ts
case 'oura_daily_summary':   // legacy — an installed APK still sends this
case 'sensor_daily_summary':
```

Dropping the legacy string in the same PR strands every queued mutation on the device — exactly the
poison-pill class CLAUDE.md warns about, and it fails silently.

### PR 3 — drop the compatibility views (a later session)

Only once (a) the code is fully migrated, (b) an APK carrying the new domain strings is installed and
verified, and (c) production has run clean for a few days. `DROP VIEW oura_daily;` etc.

## Verification

- Full suite green after each PR; the DB-backed `claude_ro` test is the one that catches a missed
  view.
- After PR 1, query a renamed table **through its compatibility view** against the local dev DB and
  confirm read *and* write both work — an updatable view is the assumption the whole safety story
  rests on, so prove it rather than assume it.
- After PR 2, exercise sync push and pull with **both** domain strings.
- Row counts before and after PR 1 must be identical: a rename must not lose a row, and 794k rows is
  where that would show.

## What would make this the wrong thing to do

If the owner decides the app stays single-source and single-user, the honest schema *is* vendor
named, and this becomes churn against 2,813 references. That is not the current direction — the
device-agnostic doc and the Play Store intent both point the other way — but it is the condition
under which to stop.

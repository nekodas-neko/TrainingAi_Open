# Runbook: Database Backup & Restore

TrainingAI's only datastore is the Railway-hosted PostgreSQL instance
(`DATABASE_URL`). There is no application-level backup job — this runbook
covers manual backup/restore against the live Railway database.

## Railway's built-in backups

⚠️ **Not verified from this environment** — check the Railway dashboard
(Postgres service → Backups tab) for what's actually enabled on the
project (automatic daily snapshots are a paid-plan feature on some Railway
tiers, not guaranteed on every plan). Confirm this manually and update this
note with the actual retention window once checked.

## Manual backup

```bash
# From a machine with pg_dump installed and network access to Railway,
# using the connection string from the Railway dashboard → Postgres → Connect:
DATABASE_URL='postgresql://...' ./scripts/db-backup.sh ./backups
```

This wraps `pg_dump --format=custom` with a datestamped filename
(`trainingai-backup-YYYY-MM-DD_HHMMSS.dump`). The custom format is required
for `pg_restore` (below) and supports selective table restore.

Equivalent manual command (if not using the wrapper script):

```bash
pg_dump --format=custom --file=trainingai-backup-$(date +%Y-%m-%d).dump "$DATABASE_URL"
```

**Recommended cadence:** before any risky migration or bulk data operation,
and periodically (e.g. weekly) for disaster recovery. This is a manual step
today — there is no scheduled job (Batch E's cron layer, if built, would be
the natural place to automate this).

## Restore to the same instance

⚠️ Destructive — this overwrites existing data. Confirm you actually want to
replace the current database contents before running.

```bash
pg_restore --clean --if-exists --dbname="$DATABASE_URL" trainingai-backup-<date>.dump
```

`--clean --if-exists` drops existing objects before recreating them from the
dump, so the target ends up matching the dump exactly.

## Restore to a new instance (disaster recovery walkthrough)

1. Provision a new Postgres instance (Railway dashboard → New → Database →
   PostgreSQL, or any Postgres 16+ host).
2. Get its connection string (`NEW_DATABASE_URL`).
3. Restore the dump into it:
   ```bash
   pg_restore --format=custom --dbname="$NEW_DATABASE_URL" trainingai-backup-<date>.dump
   ```
   (No `--clean` needed against a fresh, empty database.)
4. Verify row counts against the source instance for a few key tables
   (`users`, `workout_sessions`, `body_metrics`) before cutting over.
5. Update the Railway app service's `DATABASE_URL` environment variable to
   point at the new instance, then redeploy.

## Verifying a dump without restoring

To sanity-check a dump file's contents without touching any live database:

```bash
pg_restore --list trainingai-backup-<date>.dump | head -50
```

This prints the table of contents (schemas, tables, and row-count-bearing
objects) without executing anything.

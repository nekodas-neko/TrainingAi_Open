/**
 * BF-214 — the `claude_ro` views are ONE generated file, not a numbered migration.
 *
 * They were a numbered migration re-issued in full on every schema change: 59 copies, 92% of the
 * migration corpus, and a silent failure whenever two landed together (the later-sorting copy dropped
 * the schema the earlier one had just built). The file is now applied after the migrations, and only
 * when its content changes. These pin the four things that keep that true.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Pool } from 'pg'
import { spawnSync } from 'child_process'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { migrationTestLock } from './migration-test-lock'
import { CLAUDE_RO_VIEWS_FILE, applyClaudeRoViews, claudeRoViewsMarker } from '@/lib/data/postgres/client'

const DATABASE_URL = process.env.DATABASE_URL
const canRun = !!DATABASE_URL && !/railway|rlwy\.net/i.test(DATABASE_URL)
const MIGRATIONS = join(process.cwd(), 'lib/data/postgres/migrations')
const viewsSql = () => readFileSync(join(process.cwd(), CLAUDE_RO_VIEWS_FILE), 'utf8')

describe('claude_ro views are not a migration (BF-214)', () => {
  it('no migration builds the claude_ro schema', () => {
    // A branch cut before BF-214 still carries a numbered copy, and merging it adds the file back
    // with no conflict. It would then rebuild the schema from its OWN snapshot on deploy, and the
    // views file — unchanged, so hash-gated off — would never put the current one back.
    const offenders = readdirSync(MIGRATIONS)
      .filter(f => f.endsWith('.sql'))
      .filter(f => /(DROP|CREATE)\s+SCHEMA\b[^;]*\bclaude_ro\b/i.test(readFileSync(join(MIGRATIONS, f), 'utf8')))
    expect(offenders, 'regenerate lib/data/postgres/claude-ro-views.sql instead of adding a migration').toEqual([])
  })

  it('migrate.js records the same marker ensureSchema does', () => {
    // The two appliers are separate code (one TS, one plain JS). If their markers diverged, a
    // database built by one would rebuild the views on every start of the other.
    const src = readFileSync(join(process.cwd(), 'scripts/local-db/migrate.js'), 'utf8')
    expect(src).toContain("`claude-ro-views.sql@${createHash('sha256').update(viewsSql).digest('hex').slice(0, 16)}`")
    expect(claudeRoViewsMarker('x')).toBe(
      `claude-ro-views.sql@${'2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881'.slice(0, 16)}`)
  })
})

describe.skipIf(!canRun)('claude_ro views file against the database (BF-214)', () => {
  let pool: Pool
  const lock = migrationTestLock(() => pool)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    // This file rebuilds the claude_ro schema, which drops every GRANT on it — including ones a
    // sibling test's role holds mid-run (PS-23). Same lock as claude-ro-readonly-role.test.ts.
    await lock.acquire()
  }, 60_000)

  afterAll(async () => {
    await lock.release()
  })

  it('the committed file is exactly what the generator emits for the migrated schema', () => {
    // The check the numbered copies never had: a migration that adds a COLUMN left no trace
    // anywhere unless someone remembered to regenerate. `claude-ro-readonly-role.test.ts` counts
    // tables against views, so only a missing TABLE was ever caught.
    const run = spawnSync(process.execPath, ['scripts/generate-claude-ro-views.js'], {
      env: {
        ...process.env,
        LOCAL_DATABASE_URL: DATABASE_URL,
        // Required by the generator's refusal to run unconfigured, never written into the output.
        CLAUDE_RO_OWNER_USER_ID: '00000000-0000-0000-0000-000000000000',
      },
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(run.status, run.stderr).toBe(0)
    expect(
      run.stdout === viewsSql(),
      'lib/data/postgres/claude-ro-views.sql is stale. Regenerate it:\n' +
      '  CLAUDE_RO_OWNER_USER_ID=<uuid> node scripts/generate-claude-ro-views.js > lib/data/postgres/claude-ro-views.sql',
    ).toBe(true)
  }, 40_000)

  it('rebuilds only when the file changed, and records that it did', async () => {
    const marker = claudeRoViewsMarker(viewsSql())
    await pool.query('CREATE OR REPLACE VIEW claude_ro._bf214_sentinel AS SELECT 1 AS x')
    try {
      // Marker already recorded → nothing runs, so the sentinel survives.
      await applyClaudeRoViews(pool, new Set([marker]))
      const kept = await pool.query(`SELECT to_regclass('claude_ro._bf214_sentinel') AS r`)
      expect(kept.rows[0].r).not.toBeNull()

      // Marker absent → the file runs; its DROP SCHEMA takes the sentinel, and the marker is written.
      await pool.query('DELETE FROM schema_migrations WHERE filename = $1', [marker])
      await applyClaudeRoViews(pool, new Set())
      const gone = await pool.query(`SELECT to_regclass('claude_ro._bf214_sentinel') AS r`)
      expect(gone.rows[0].r).toBeNull()
      const users = await pool.query(`SELECT to_regclass('claude_ro.users') AS r`)
      expect(users.rows[0].r).not.toBeNull()
      const rec = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [marker])
      expect(rec.rowCount).toBe(1)
    } finally {
      await pool.query('DROP VIEW IF EXISTS claude_ro._bf214_sentinel')
    }
  })

  it('a file that fails halfway leaves the previous views standing, and records nothing', async () => {
    // The file opens with DROP SCHEMA. Without the transaction, a failure after that line would
    // leave production with no claude_ro schema at all until the next deploy.
    const broken = 'DROP SCHEMA IF EXISTS claude_ro CASCADE;\nCREATE SCHEMA claude_ro;\nSELECT bf214_no_such_function();\n'
    const brokenMarker = claudeRoViewsMarker(broken)
    await pool.query('CREATE OR REPLACE VIEW claude_ro._bf214_sentinel AS SELECT 1 AS x')
    try {
      await applyClaudeRoViews(pool, new Set(), broken)
      const kept = await pool.query(`SELECT to_regclass('claude_ro._bf214_sentinel') AS r`)
      expect(kept.rows[0].r).not.toBeNull()
      const users = await pool.query(`SELECT to_regclass('claude_ro.users') AS r`)
      expect(users.rows[0].r).not.toBeNull()
      const rec = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [brokenMarker])
      expect(rec.rowCount).toBe(0)
    } finally {
      await pool.query('DROP VIEW IF EXISTS claude_ro._bf214_sentinel')
    }
  })
})

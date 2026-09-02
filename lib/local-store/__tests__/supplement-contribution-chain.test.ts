// BF-69 stage 1 — the device half of the contribution chain, asserted at source.
//
// CLAUDE.md's rule for a synced domain is that the whole chain moves in one pass: local table
// columns = server payload fields = `getSyncDelta` output = `pullDelta` mapping = `applyDelta`
// upsert columns. TypeScript cannot see a gap here, because `source`/`sourceRef` are optional on
// `LocalSupplementLog` — a mapper that drops them compiles, and the failure is a meal contribution
// arriving from the server and being applied as if it were the manual one, collapsing the day back
// to a single row. That is the exact bug the contribution rows exist to prevent, reintroduced by
// the pull.
//
// Source-level because both vitest projects run in `node`: `getLocalStore` returns null there, so
// there is no local SQLite to exercise. `supplement-dose-chain.test.ts` scans for the same reason.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const backend = read('lib/local-store/sqlite-backend.ts')
const engine = read('lib/local-store/sync-engine.ts')
const migrations = read('lib/sqlite/migrations.ts')

/** The body of a named function, so a match cannot be satisfied by a different one in the file. */
function fnBody(src: string, signature: string): string {
  const i = src.indexOf(signature)
  expect(i, `${signature} not found`).toBeGreaterThan(-1)
  const rest = src.slice(i)
  const end = rest.indexOf('\n  }\n')
  return rest.slice(0, end === -1 ? rest.length : end)
}

describe('the local schema carries the contribution (BF-69)', () => {
  it('the supplement_logs table has source and source_ref, and no whole-day UNIQUE', () => {
    const create = migrations.slice(
      migrations.indexOf('const CREATE_SUPPLEMENT_LOGS'),
      migrations.indexOf('const CREATE_INJURIES'))
    expect(create).toContain('source        TEXT NOT NULL DEFAULT \'manual\'')
    expect(create).toContain('source_ref    TEXT')
    // The constraint that made two doses on a day impossible. SQLite cannot drop an inline table
    // constraint, which is why v34 rebuilds the table rather than ALTERing it.
    expect(create).not.toContain('UNIQUE(supplement_id, log_date)')
  })

  it('the supplements table has the presence window', () => {
    const create = migrations.slice(
      migrations.indexOf('const CREATE_SUPPLEMENTS'),
      migrations.indexOf('const CREATE_SUPPLEMENT_LOGS'))
    for (const col of ['started_on', 'stopped_on', 'dose_prompt']) {
      expect(create, `supplements.${col} missing`).toContain(col)
    }
  })

  // reconcileSchema is the real schema authority after a partial upgrade, and v34 is the most
  // failure-prone migration in this file because it rebuilds a table rather than adding a column.
  it('every new column is registered for reconcile', () => {
    for (const col of ['source', 'source_ref', 'started_on', 'stopped_on', 'dose_prompt']) {
      expect(migrations, `${col} not in RECONCILE_COLUMNS`)
        .toMatch(new RegExp(`column: '${col}'`))
    }
  })

  // The replacement for the constraint the rebuild drops. Without it the tick is no longer
  // idempotent: a double-tap or a replayed outbox mutation records the dose twice.
  it('the partial unique index is in the reconcile list, not only in the upgrade', () => {
    const reconcile = migrations.slice(
      migrations.indexOf('const RECONCILE_INDEXES'),
      migrations.indexOf('export const RECONCILE_TABLES'))
    expect(reconcile).toContain('idx_supplement_logs_manual_day')
    // Soft-deleted rows stay INSIDE the index on purpose — that is what keeps an untick-then-re-tick
    // reviving one row instead of leaving two, and what lets applyDelta address a manual row by its
    // natural key.
    expect(reconcile).toMatch(/idx_supplement_logs_manual_day[^`]*WHERE source = 'manual'`/)
  })

  // Re-runnability is the whole reason v34 is written the way it is: a local migration that throws
  // on retry leaves open() throwing forever (#85), and a rebuild has more ways to half-apply than
  // an ADD COLUMN does.
  it('the v34 rebuild can be re-run from any partial state', () => {
    const v34 = migrations.slice(migrations.indexOf('toVersion: 34'))
    // The resurrection stub: without it, a retry after a successful DROP but a failed RENAME reads
    // from a table that no longer exists.
    expect(v34.indexOf('CREATE TABLE IF NOT EXISTS supplement_logs ('))
      .toBeLessThan(v34.indexOf('FROM supplement_logs'))
    expect(v34).toContain('INSERT OR IGNORE INTO supplement_logs_new')
    expect(v34).toContain('ALTER TABLE supplement_logs_new RENAME TO supplement_logs')
    // No PRAGMAs: the plugin wraps upgrades in a transaction and SQLite rejects journal-mode
    // changes inside one (#27). Comments are stripped first — the migration's own prose says the
    // word, and a source-scanning guard whose first finding is its own documentation has happened
    // three times in this repository.
    const statements = v34.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(statements).not.toMatch(/PRAGMA/)
  })
})

describe('the local write is contribution-scoped (BF-69)', () => {
  const upsert = fnBody(backend, 'async upsertSupplementLog(record')
  const del = fnBody(backend, 'async deleteSupplementLog(supplementId')

  it('writes source and source_ref', () => {
    for (const col of ['source', 'source_ref']) {
      expect(upsert, `supplement_logs.${col} not written`).toContain(col)
    }
  })

  it('upserts on the manual partial index, not the old whole-day key', () => {
    expect(upsert).toContain("ON CONFLICT(supplement_id, log_date) WHERE source = 'manual'")
  })

  // The deletion bug: before contributions this soft-deleted the day's row with no notion of who
  // wrote it, so unticking on the supplements page would have wiped a dose a meal contributed.
  it('deletes only the manual contribution', () => {
    expect(del).toContain("source='manual'")
  })
})

describe('the pull carries the contribution (BF-69)', () => {
  it('pullDelta maps source and sourceRef onto the log rows', () => {
    const map = engine.slice(engine.indexOf('const supplementLogs = ('), engine.indexOf('const injuries = ('))
    expect(map).toContain('source:')
    expect(map).toContain('sourceRef:')
  })

  it('pullDelta maps the presence window onto the definitions', () => {
    const map = engine.slice(engine.indexOf('const supplements = ('), engine.indexOf('const supplementLogs = ('))
    for (const field of ['startedOn', 'stoppedOn', 'dosePrompt']) {
      expect(map, `${field} dropped by the pull`).toContain(`${field}:`)
    }
  })

  // A day can now hold a meal's dose beside the tick's, so a bare find on supplementId would enrich
  // — and confirm — the tick's mutation with the meal's amount.
  it('the push path narrows to the manual contribution', () => {
    const enrich = engine.slice(engine.indexOf('async function enrichPayload'))
    expect(enrich.slice(0, enrich.indexOf('\n}\n'))).toContain("=== 'manual'")
    const confirm = engine.slice(engine.indexOf("} else if (m.domain === 'supplement_logs') {"))
    expect(confirm.slice(0, 400)).toContain("=== 'manual'")
  })

  it('applyDelta addresses a meal contribution by id and a manual one by its natural key', () => {
    const arm = backend.slice(
      backend.indexOf('for (const r of delta.supplementLogs ?? [])'),
      backend.indexOf('for (const r of delta.injuries ?? [])'))
    expect(arm).toContain('const isMeal = ')
    expect(arm).toContain('DELETE FROM supplement_logs WHERE id=?')
    expect(arm).toContain("source='manual'")
    expect(arm).toContain('ON CONFLICT(id) DO UPDATE SET')
  })
})

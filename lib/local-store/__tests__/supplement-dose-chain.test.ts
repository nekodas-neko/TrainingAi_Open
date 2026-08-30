// BF-3 — the device half of the chain, asserted at source.
//
// CLAUDE.md's rule for a synced domain is that the whole chain moves in one pass: local table
// columns = server payload fields = `getSyncDelta` output = `pullDelta` mapping = `applyDelta`
// upsert columns, plus the `pushMutations` branch mirroring the web route. **The pull mapping is
// where this one was actually half-done**, and TypeScript could not see it: the fields are optional
// on `LocalSupplementLog`, so a mapper that dropped them compiled. A fresh device would have shown
// every past log at the definition's current dose — the exact bug the columns were added to stop.
//
// Source-level because both vitest projects run in `node`: `getLocalStore` returns null there, so
// there is no local SQLite to exercise. `local-store-write-fallback.test.ts` scans a file for a
// shape for the same reason.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const backend = read('lib/local-store/sqlite-backend.ts')
const engine = read('lib/local-store/sync-engine.ts')

/** The body of a named function, so a match cannot be satisfied by a different one in the file. */
function fnBody(src: string, signature: string): string {
  const i = src.indexOf(signature)
  expect(i, `${signature} not found`).toBeGreaterThan(-1)
  const rest = src.slice(i)
  const end = rest.indexOf('\n  }\n')
  return rest.slice(0, end === -1 ? rest.length : end)
}

describe('the local write freezes the dose (BF-3)', () => {
  const upsert = fnBody(backend, 'async upsertSupplementLog(record')

  it('writes the three dose columns', () => {
    for (const col of ['amount', 'unit', 'dose_text']) {
      expect(upsert, `supplement_logs.${col} not written`).toContain(col)
    }
  })

  // Doing this in the store rather than at the call site is what makes today's UI freeze the dose
  // with no change to the UI — `supplements-section.tsx` passes no dose and does not need to.
  it('falls back to the local definition when the caller supplies none', () => {
    expect(upsert).toMatch(/SELECT dose, default_amount, unit FROM supplements WHERE id = \?/)
  })

  // …and a caller that DOES supply one wins, which is how a replayed offline log keeps the dose it
  // was taken at rather than the one the definition shows now.
  it('prefers what the caller supplied', () => {
    expect(upsert).toContain('record.amount ?? null')
    expect(upsert).toContain('record.doseText ?? null')
  })

  it('updates them on conflict too, rather than only on insert', () => {
    expect(upsert).toContain('amount=excluded.amount')
    expect(upsert).toContain('dose_text=excluded.dose_text')
  })
})

describe('the pull carries the dose — the half that was missing', () => {
  it('maps all three onto the local log', () => {
    const i = engine.indexOf('const supplementLogs = ')
    const map = engine.slice(i, engine.indexOf('satisfies LocalSupplementLog', i))
    expect(map).toContain('amount:')
    expect(map).toContain('unit:')
    expect(map).toContain('doseText:')
  })

  it('maps the definition’s structured dose too', () => {
    const i = engine.indexOf('const supplements = ')
    const map = engine.slice(i, engine.indexOf('satisfies LocalSupplement', i))
    expect(map).toContain('defaultAmount:')
    expect(map).toContain('unit:')
  })

  it('applyDelta writes them, so a pull cannot land a log without its dose', () => {
    const i = backend.indexOf("for (const r of delta.supplementLogs")
    const arm = backend.slice(i, backend.indexOf('for (const r of delta.injuries', i))
    expect(arm).toContain('dose_text')
    expect(arm).toContain('r.doseText ?? null')
  })
})

describe('the push sends what was recorded, not what the definition says now', () => {
  it('enriches a supplement_logs payload from the local row', () => {
    const enrich = fnBody(engine, 'async function enrichPayload(')
    expect(enrich).toContain("m.domain !== 'supplement_logs'")
    expect(enrich).toContain('getSupplementLogs')
    expect(enrich).toContain('row.doseText ?? null')
  })

  // The enrichment is worthless unless the sender calls it — this is the wiring, and it is the part
  // a refactor drops silently.
  it('is actually called by the push', () => {
    expect(engine).toMatch(/payload: await enrichPayload\(store, m\)/)
  })

  // A deletion carries no dose and must not be given one.
  it('leaves a delete alone', () => {
    expect(fnBody(engine, 'async function enrichPayload(')).toContain('m.payload.deleted')
  })
})

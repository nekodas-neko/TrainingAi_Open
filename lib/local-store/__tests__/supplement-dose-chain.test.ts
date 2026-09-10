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

  // OR-104 — the definition's free text is frozen only when it has no structured amount, and that
  // decision is SHARED with the server so the two write paths cannot drift. Asserted here as a
  // delegation rather than a behaviour: this suite greps source (no local SQLite in node), so a
  // change back to the old expression passes every behavioural test in the repo. The rule itself is
  // executed in `packages/shared/src/nutrition/__tests__/supplement-dose-freeze.test.ts`; this is
  // the half that catches the wiring being undone.
  //
  // LA-90 widened what is shared: the whole caller-vs-definition merge is now `resolveLoggedDose`,
  // which calls `freezableDoseText` itself. Asserting the outer call is the stronger check — the
  // free-text rule cannot be re-implemented locally without also un-sharing the merge around it.
  it('delegates the free-text decision to the shared rule', () => {
    expect(upsert).toContain('resolveLoggedDose(caller,')
    expect(backend).toContain("from '@trainingai/shared/nutrition/supplement-dose-freeze'")
    // The two shapes it replaced: stamping the prose whatever the amount said (OR-104), and
    // re-deriving the free text locally instead of through the shared rule (LA-90).
    expect(upsert).not.toContain('doseText: def.dose ? String(def.dose) : null')
    expect(upsert).not.toContain('freezableDoseText(')
  })

  // LA-90 — the local store used to read the definition only when the caller supplied NOTHING, so a
  // partial dose kept its nulls offline while the server filled them per field. The guard is now
  // "any field still missing", which is what the shared per-field merge needs to have something to
  // merge against.
  it('reads the definition whenever a field is still missing, not only when all are', () => {
    expect(upsert).toContain('caller.amount == null || caller.unit == null || caller.doseText == null')
    expect(upsert).not.toContain('dose.amount == null && dose.unit == null && dose.doseText == null')
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
    // LA-97 — the four OR-102a fields travel too, or the server re-stamps them at push time.
    expect(enrich).toContain('row.takenAt ?? null')
    expect(enrich).toContain('row.vialStrengthMg ?? null')
    expect(enrich).toContain('row.vialWaterMl ?? null')
    expect(enrich).toContain('row.vialUnitsPerMl ?? null')
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

// LA-97 — the step that made the other three unreachable, and the reason it hid.
//
// `getSupplementLogs` does `SELECT *`, so the rows carried OR-102a's four columns from the day the
// migration ran. Its row→object mapper listed ten fields and stopped, so the freeze was WRITE-ONLY:
// `enrichPayload` reads a log through this mapper to build its push payload, and could not forward
// what it could not see. Every test in the repo passed throughout.
//
// Greps source because native SQLite does not run in node — the same reason this whole suite does.
// The behavioural half is `supplement-vial-freeze.test.ts`, which drives the server for real.
describe('the local read surfaces what the local write froze (LA-97)', () => {
  const getter = fnBody(backend, 'async getSupplementLogs(')

  it('maps every OR-102a column back out of the row', () => {
    expect(getter).toContain('takenAt:')
    expect(getter).toContain('vialStrengthMg:')
    expect(getter).toContain('vialWaterMl:')
    expect(getter).toContain('vialUnitsPerMl:')
  })

  it('reads the vial numbers as numbers, not truthily — 0 is a real strength', () => {
    // `r.unit ? String(r.unit) : null` is right for text and wrong here: a 0 would become null.
    expect(getter).toContain('r.vial_strength_mg == null ? null : Number(r.vial_strength_mg)')
    expect(getter).not.toContain('r.vial_strength_mg ? Number(')
  })
})

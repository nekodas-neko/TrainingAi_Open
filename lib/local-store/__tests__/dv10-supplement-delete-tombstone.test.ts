// DV-10 — deleting a supplement left no tombstone, and quietly blanked five columns.
//
// Source-level for the same reason as its siblings: both vitest projects run in `node`, where
// `getLocalStore` returns null, so there is no local SQLite to drive. The device half is DV-10's
// own pass test (`SELECT deleted_at FROM supplements WHERE id=…` is set after a delete on the S25).
//
// Measured on the S25 before the fix: deleting a supplement online and offline removed it from the
// server and from both lists, but the local row kept `deleted_at: null`. An injury deleted the same
// way tombstones correctly — supplements were the one domain doing it by rebuilding a record.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const backend = read('lib/local-store/sqlite-backend.ts')
const iface = read('lib/local-store/index.ts')
const sheet = read('components/nutrition/manage-supplements-sheet.tsx')

/** The body of a named function, so a match cannot be satisfied by a different one in the file. */
function fnBody(src: string, signature: string): string {
  const i = src.indexOf(signature)
  expect(i, `${signature} not found`).toBeGreaterThan(-1)
  const rest = src.slice(i)
  const end = rest.indexOf('\n  }\n')
  return rest.slice(0, end === -1 ? rest.length : end)
}

describe('DV-10 — the supplement delete leaves a tombstone', () => {
  const body = fnBody(backend, 'async deleteSupplement(id: string)')

  it('sets deleted_at, the thing the delta carries', () => {
    expect(body).toMatch(/deleted_at=\?/)
  })

  it('also clears active, because getSupplements filters on BOTH', () => {
    // `SELECT * FROM supplements WHERE active=1 AND deleted_at IS NULL` — dropping either half of
    // the write would leave the row visible in the list the delete was issued from.
    expect(body).toMatch(/active=0/)
    expect(fnBody(backend, 'async getSupplements()')).toMatch(/active=1 AND deleted_at IS NULL/)
  })

  it('marks the row pending, so the push confirms it and the pull may then prune it', () => {
    // applyDelta's supplements arm is `DELETE … WHERE id = ? AND sync_status='synced'`, and the
    // confirm arm (Q-124) flips it to synced. A delete that left the row `synced` would be
    // prunable before its own push had been acknowledged.
    expect(body).toMatch(/sync_status='pending'/)
  })

  it('is on the store interface, not just the backend', () => {
    expect(iface).toMatch(/deleteSupplement\(id: string\): Promise<void>/)
  })
})

describe('DV-10 — the delete must not rewrite the rest of the row', () => {
  // The second defect, and the one nobody was looking for. The sheet used to call
  // `upsertSupplement({ …the fields it happened to hold, active: false })`, and that upsert writes
  // `default_amount`, `unit`, `started_on`, `stopped_on` and `dose_prompt` with `?? null` — so a
  // delete blanked all five on the local row. `startedOn`/`stoppedOn` are BF-69's presence window,
  // where a date OUTSIDE the window is a TRUE ZERO and a date inside it with no contribution is
  // UNKNOWN; nulling them converts one into the other for any local aggregate read before the next
  // pull hard-deletes the row.
  const body = fnBody(backend, 'async deleteSupplement(id: string)')

  it('touches only the delete columns', () => {
    for (const col of ['default_amount', 'unit', 'started_on', 'stopped_on', 'dose_prompt', 'name', 'dose']) {
      expect(body, `deleteSupplement writes ${col}, which a delete has no business changing`)
        .not.toMatch(new RegExp(`\\b${col}\\s*=`))
    }
  })

  it('is an UPDATE, not an INSERT … ON CONFLICT', () => {
    // An upsert cannot express "leave the other columns alone" — it always supplies every one.
    expect(body).toMatch(/UPDATE supplements SET/)
    expect(body).not.toMatch(/INSERT INTO/)
  })

  it('the sheet calls it instead of rebuilding a record', () => {
    expect(sheet).toMatch(/store\.deleteSupplement\(id\)/)
    // The old shape, which is what blanked the columns.
    expect(sheet, 'the delete handler still upserts a rebuilt supplement')
      .not.toMatch(/active:\s*false/)
  })
})

// RV-40 — `invalidUuidResponse` was swept across the dynamic `[id]` routes and never pointed at an
// id taken from a request BODY, which is the same hazard through a different door.
//
// Measured live before the fix: `DELETE /api/progression-styles {"id":"not-a-uuid"}` and
// `POST /api/workout-templates {"recalibrateCycleAnchor":true,"programId":"not-a-uuid"}` both
// answered **500 with Content-Length 0**. Three consequences, all of them measured:
//
//   1. A client calling `res.json()` on a zero-byte 500 gets a parse exception on top of the real
//      fault — the rationale RV-33 gave for the ownership half of this same file.
//   2. The malformed id reached the driver as a 22P02, so the failing statement — raw SQL, table and
//      column names included — was written into `error_events` as a server fault. Five probes made
//      five rows; the same probes make zero now.
//   3. It is a client input error answered as a server fault, in the channel every session is told
//      to read first.
//
// Checked from SOURCE rather than at runtime. These are the two routes the sweep missed out of a
// population of eight candidates (the other six answer 4xx already, re-measured 2026-09-11), so what
// must not regress is that the guard is present — a runtime test would re-assert what the shared
// helper already guarantees, while this pins the thing that was actually absent.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The two that were broken. Each entry names the body field whose id reached the driver.
const GUARDED_BODY_IDS: [file: string, field: string][] = [
  ['app/api/progression-styles/route.ts', 'body.id'],
  ['app/api/workout-templates/route.ts', 'body.programId'],
]

describe('RV-40 — a body-supplied id is guarded like a path one', () => {
  it.each(GUARDED_BODY_IDS)('%s guards %s with invalidUuidResponse', (file, field) => {
    const src = readFileSync(file, 'utf8')
    expect(src).toContain('invalidUuidResponse')
    expect(src).toContain(`invalidUuidResponse(${field})`)
  })

  it.each(GUARDED_BODY_IDS)('%s imports the guard from the shared module', file => {
    const src = readFileSync(file, 'utf8')
    // Not a local re-implementation: the message and status are the same for every route by design,
    // and `isUuid` lives in packages/shared precisely so this import costs nothing.
    expect(src).toMatch(/import \{[^}]*invalidUuidResponse[^}]*\} from ["']@\/lib\/api\/route-errors["']/)
  })

  // The guard must not fire when the field is absent. `DELETE /api/progression-styles` accepts
  // EITHER an id or a name, and guarding unconditionally would have made delete-by-name answer
  // "Invalid id" for every request — the exact shape of the BF-53 regression that a uuid guard on
  // two integer-keyed routes caused, where the guard broke every real call instead of none.
  it('progression-styles only rejects when an id was actually supplied', () => {
    const src = readFileSync('app/api/progression-styles/route.ts', 'utf8')
    expect(src).toContain('if (body.id && badId) return badId')
  })
})

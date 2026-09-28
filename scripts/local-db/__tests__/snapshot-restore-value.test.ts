// The snapshot loader turns each NDJSON value back into what its column needs. The bytea case
// was missing: a Buffer exported as {"type":"Buffer","data":[…]} was stored as that JSON's text,
// corrupting every packed raw frame in a local snapshot (found by TN-56's replay).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { restoreValue } = require('../snapshot.js')

describe('restoreValue', () => {
  it('rebuilds a bytea from the exported Buffer object', () => {
    const v = restoreValue({ type: 'Buffer', data: [1, 7, 255, 158] }, { json: false, bytea: true })
    expect(Buffer.isBuffer(v)).toBe(true)
    expect([...v]).toEqual([1, 7, 255, 158])
  })

  it("accepts Postgres's own \\x hex text for a bytea", () => {
    expect([...restoreValue(String.raw`\x01ff`, { json: false, bytea: true })]).toEqual([1, 255])
  })

  it('still stringifies json, and leaves everything else and null alone', () => {
    expect(restoreValue([1, 2], { json: true, bytea: false })).toBe('[1,2]')
    expect(restoreValue('text', { json: false, bytea: false })).toBe('text')
    expect(restoreValue(null, { json: false, bytea: true })).toBeNull()
  })
})

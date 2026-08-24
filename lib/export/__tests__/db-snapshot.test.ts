import { describe, it, expect } from 'vitest'
import { checkDrift, resolveRequestedTables, bulkWindowFor, BULK_TABLES, type TableColumns } from '../db-snapshot'

function cols(over: Partial<TableColumns> = {}): TableColumns {
  return {
    publicTables: new Map([['workout_sessions', ['id', 'user_id', 'started_at']]]),
    views: new Map([['workout_sessions', ['id', 'user_id', 'started_at']]]),
    excludedTables: new Set(),
    withheldColumns: new Map(),
    ...over,
  }
}

describe('checkDrift', () => {
  it('passes when every public table has a view or is excluded', () => {
    expect(() => checkDrift(cols())).not.toThrow()
  })

  it('passes when a table is deliberately excluded rather than viewed', () => {
    const c = cols({
      publicTables: new Map([['invited_emails', ['id', 'email']]]),
      views: new Map(),
      excludedTables: new Set(['invited_emails']),
    })
    expect(() => checkDrift(c)).not.toThrow()
  })

  it('fails and names the table when a public table has no view and is not excluded', () => {
    const c = cols({
      publicTables: new Map([['workout_sessions', ['id']], ['new_table', ['id']]]),
      views: new Map([['workout_sessions', ['id']]]),
    })
    expect(() => checkDrift(c)).toThrow(/new_table.*has no claude_ro view/)
  })

  it('fails and names the table+column when a column is neither viewed nor withheld', () => {
    const c = cols({
      publicTables: new Map([['users', ['id', 'email', 'new_secret_field']]]),
      views: new Map([['users', ['id', 'email']]]),
      withheldColumns: new Map([['users', new Set(['password_hash'])]]),
    })
    expect(() => checkDrift(c)).toThrow(/users\.new_secret_field/)
  })

  it('passes when a missing column is explicitly withheld', () => {
    const c = cols({
      publicTables: new Map([['users', ['id', 'password_hash']]]),
      views: new Map([['users', ['id']]]),
      withheldColumns: new Map([['users', new Set(['password_hash'])]]),
    })
    expect(() => checkDrift(c)).not.toThrow()
  })

  it('skips column checks entirely for an excluded table', () => {
    // rate_limits carries columns the withheld-columns map knows nothing about — must not fail,
    // because the whole table is denied, not partially viewed.
    const c = cols({
      publicTables: new Map([['rate_limits', ['id', 'key', 'window_start']]]),
      views: new Map(),
      excludedTables: new Set(['rate_limits']),
    })
    expect(() => checkDrift(c)).not.toThrow()
  })
})

describe('resolveRequestedTables', () => {
  const c = cols({
    views: new Map([
      ['workout_sessions', ['id']],
      ['oura_raw_samples', ['id']],
    ]),
    excludedTables: new Set(['rate_limits']),
  })

  it('includes every view by default, excluding bulk tables', () => {
    const { toExport, omitted } = resolveRequestedTables(c, null, null)
    expect(toExport).toEqual(['workout_sessions'])
    expect(omitted.find(o => o.table === 'oura_raw_samples')?.reason).toMatch(/bulk table/)
  })

  it('includes a bulk table when bulk=all', () => {
    const { toExport } = resolveRequestedTables(c, null, 'all')
    expect(toExport).toContain('oura_raw_samples')
  })

  it('includes a bulk table when bulk=<days>', () => {
    const { toExport } = resolveRequestedTables(c, null, '7')
    expect(toExport).toContain('oura_raw_samples')
  })

  it('omits bulk tables when bulk=0 (explicit default)', () => {
    const { toExport, omitted } = resolveRequestedTables(c, null, '0')
    expect(toExport).not.toContain('oura_raw_samples')
    expect(omitted.some(o => o.table === 'oura_raw_samples')).toBe(true)
  })

  it('honours an explicit tables= allowlist', () => {
    const { toExport } = resolveRequestedTables(c, 'workout_sessions', null)
    expect(toExport).toEqual(['workout_sessions'])
  })

  it('names an excluded table with its reason, distinct from an unknown one', () => {
    const { omitted } = resolveRequestedTables(c, 'rate_limits,not_a_real_table', null)
    expect(omitted.find(o => o.table === 'rate_limits')?.reason).toMatch(/denied/)
    expect(omitted.find(o => o.table === 'not_a_real_table')?.reason).toBe('unknown table')
  })
})

describe('bulkWindowFor', () => {
  it('returns null for a non-bulk table regardless of the bulk param', () => {
    expect(bulkWindowFor('workout_sessions', '7')).toBeNull()
  })

  it('returns null for bulk=all — no window, the whole table', () => {
    expect(bulkWindowFor(BULK_TABLES[0], 'all')).toBeNull()
  })

  it('returns null for bulk=0 or unset', () => {
    expect(bulkWindowFor(BULK_TABLES[0], '0')).toBeNull()
    expect(bulkWindowFor(BULK_TABLES[0], null)).toBeNull()
  })

  it('returns a window ~N days back for bulk=<days>', () => {
    const win = bulkWindowFor('error_events', '7')
    expect(win?.column).toBe('created_at')
    const daysAgo = (Date.now() - win!.date.getTime()) / 86_400_000
    expect(daysAgo).toBeGreaterThan(6.9)
    expect(daysAgo).toBeLessThan(7.1)
  })

  it('picks the right ingest-time column per bulk table', () => {
    expect(bulkWindowFor('oura_raw_samples', '1')?.column).toBe('recorded_at')
    expect(bulkWindowFor('oura_heartrate', '1')?.column).toBe('timestamp')
    expect(bulkWindowFor('rr_intervals', '1')?.column).toBe('at')
  })
})

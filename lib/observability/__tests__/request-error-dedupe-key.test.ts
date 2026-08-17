import { describe, it, expect, beforeEach } from 'vitest'
import {
  normaliseErrorKey,
  shouldRecordRequestError,
  resetRequestErrorDedupe,
} from '@/lib/observability/request-error'

// Q-539: one fault wrote 5,771 rows and cost 49 MB, because Drizzle embeds the generated VALUES
// list in its failure message — so a batch of 40 and a batch of 41 were different strings for the
// same broken query and the 60 s window let each one through. Measured on those rows: 18 distinct
// messages, 1 distinct 60-character prefix.
const cardinalityViolation = (rows: number) =>
  'Failed query: insert into "oura_heartrate" ("id", "user_id", "timestamp", "bpm") values ' +
  Array.from({ length: rows }, () => '(default, $1, $2, $3)').join(', ') +
  ' on conflict do update set "bpm" = excluded."bpm"'

describe('request-error dedupe key normalisation (Q-539)', () => {
  beforeEach(() => resetRequestErrorDedupe())

  it('collapses the same fault at different batch sizes to one key', () => {
    const keys = new Set([40, 41, 128, 255].map(n => normaliseErrorKey(cardinalityViolation(n))))
    expect(keys.size).toBe(1)
  })

  // The regression the entry actually describes: the window is fine, the key defeated it.
  it('records the fault once per window instead of once per batch size', () => {
    const t = 1_000_000
    const attempts = [40, 41, 42, 128, 255, 17, 3].map(n =>
      shouldRecordRequestError(`u|/api/oura-ble/samples|${normaliseErrorKey(cardinalityViolation(n))}`, t),
    )
    expect(attempts.filter(Boolean)).toHaveLength(1)
  })

  it('without normalisation the same run writes a row every time — the bug', () => {
    const t = 1_000_000
    const attempts = [40, 41, 42, 128, 255, 17, 3].map(n =>
      shouldRecordRequestError(`u|/api/oura-ble/samples|${cardinalityViolation(n)}`, t),
    )
    expect(attempts.filter(Boolean)).toHaveLength(7)
  })

  it('still separates genuinely different faults', () => {
    const a = normaliseErrorKey(cardinalityViolation(40))
    const b = normaliseErrorKey('Failed query: insert into "sleep_sessions" ("id") values (default, $1)')
    const c = normaliseErrorKey('canceling statement due to statement timeout')
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('does not collapse two different tables that share a VALUES shape', () => {
    const hr = normaliseErrorKey(cardinalityViolation(40))
    const rr = normaliseErrorKey(cardinalityViolation(40).replace('oura_heartrate', 'rr_intervals'))
    expect(hr).not.toBe(rr)
  })

  it('bounds the key so a 2 kB message cannot become a 2 kB map entry', () => {
    expect(normaliseErrorKey(cardinalityViolation(2000)).length).toBeLessThanOrEqual(500)
  })

  it('leaves a short ordinary message alone', () => {
    expect(normaliseErrorKey('Connection terminated unexpectedly')).toBe('Connection terminated unexpectedly')
  })
})

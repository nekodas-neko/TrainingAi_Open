import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isQualified, qualifierPhrase } from '@/components/health/score-qualifier'

/**
 * Q-529 — a still-syncing night's score was rendered exactly like a settled one.
 *
 * The server half already existed: `/api/sleep-sessions` has returned a per-night `provisional`
 * flag since BF-83 (2026-09-01). No client surface read it, so the entry's own claim that sleep has
 * no provisional concept was stale by the time it was picked up. This covers the client half.
 *
 * The predicate is driven directly; the wiring is asserted against source, because these are `.tsx`
 * screens needing a canvas and both vitest projects run `environment: 'node'`.
 */

const ROOT = path.resolve(__dirname, '..', '..')
const source = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const stripped = (rel: string) => source(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('when a score cell is qualified', () => {
  it('treats provisional as a qualifier in its own right', () => {
    expect(isQualified({ provisional: true }, '62')).toBe(true)
    expect(isQualified({ lowWear: true }, '62')).toBe(true)
    expect(isQualified({ limited: true }, '62')).toBe(true)
    expect(isQualified({}, '62')).toBe(false)
  })

  it('never marks an empty cell — a dash has nothing to qualify', () => {
    expect(isQualified({ provisional: true, lowWear: true, limited: true }, '—')).toBe(false)
  })
})

describe('what the cell says out loud', () => {
  it('names the provisional case as one that can still change', () => {
    // "Still syncing" alone would read as a transfer detail. What the listener needs is that the
    // number they just heard is not final.
    expect(qualifierPhrase({ provisional: true })).toBe(
      ' — last night is still syncing, so this number can still change',
    )
  })

  it('reads every qualifier that applies, not just the first', () => {
    // They are independent — a night can be short on wear AND still syncing — and hearing only one
    // would leave the other silently dropped.
    const phrase = qualifierPhrase({ lowWear: true, limited: true, provisional: true })
    expect(phrase).toContain("ring wasn't worn enough")
    expect(phrase).toContain('part of the usual inputs')
    expect(phrase).toContain('still change')
  })

  it('says nothing at all when the reading is clean', () => {
    expect(qualifierPhrase({})).toBe('')
  })
})

describe('the chip row uses the shared predicate at every site', () => {
  const chip = () => stripped('components/oura-score-chip-row.tsx')

  it('has no hand-written qualifier condition left', () => {
    // Three sites carried `(lowWear || limited) && display !== "—"`, so a third qualifier had to
    // find all three. That is the drift this extraction removes; a copy coming back reintroduces it.
    expect(chip()).not.toMatch(/lowWear \|\| .*limited\).*!==/)
  })

  it('marks the sleep cell from the night, not from the readiness payload', () => {
    // Pinned as one pattern: asserting the prop name and the field separately would pass against a
    // cell that reads the flag and never uses it.
    expect(chip()).toMatch(/href: "\/health\/sleep",[\s\S]{0,120}?provisional: sleepProvisional,/)
  })
})

describe('the surfaces that show a night in full', () => {
  it('marks the Body tab sleep card', () => {
    expect(stripped('components/health/body-cards/sleep-card.tsx'))
      .toMatch(/\{recentSleep\?\.provisional && <ProvisionalBadge \/>\}/)
  })

  it('marks the sleep detail screen, which is where the chip leads', () => {
    expect(stripped('app/health/sleep/sleep-content.tsx')).toMatch(/\{latest\?\.provisional &&/)
  })

  it('feeds the Home chip from the most recent night', () => {
    // Rows arrive `orderBy(desc(date))` and `mergeByDate` preserves that order, so [0] is last
    // night. Indexing the other end would silently never mark anything.
    expect(stripped('app/session-select/session-select-content.tsx'))
      .toMatch(/sleepProvisional=\{sleepData\[0\]\?\.provisional === true\}/)
  })

  it('treats an absent flag as settled, not as still-filling', () => {
    // The local-store seed cannot compute it — there is no rollup watermark on the device — so the
    // flag is undefined offline. `=== true` is what keeps that from badging every night.
    const src = stripped('app/session-select/session-select-content.tsx')
    expect(src).toContain('?.provisional === true')
    expect(src).not.toMatch(/sleepProvisional=\{sleepData\[0\]\?\.provisional\}/)
  })
})

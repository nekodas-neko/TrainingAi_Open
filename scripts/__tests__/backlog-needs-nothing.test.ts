import { describe, expect, it } from 'vitest'
import { parseEntries, parkReasons, declaresNothing } from '../lib/backlog-entries.js'

/**
 * A `Needs:` field's id extraction reads the whole line, so the sentence explaining why a dependency
 * was REMOVED used to put it back.
 *
 * Measured on 2026-09-29: **six entries across four lanes** were parked by their own clearing note —
 * `LB-166` by *"⚠ This said `LB-149` until 2026-09-28, and the dependency was INVERTED"*, `BF-220` and
 * `BF-221` by *"Shares a cause with BF-219 but is separately buildable"*, `BF-192` by a note saying the
 * policy choices *"are carried here so this entry is buildable"*. Every one of them said, in the very
 * line that parked it, that it was not blocked. Lane B's READY list read **0** as a result and went to
 * 3 when this was fixed.
 *
 * Same class as `decorated-field.js`: a matcher reading a MENTION as a declaration.
 */
// `PS-` because the ids must carry a prefix `scripts/lib/entry-id.js` knows. An unregistered one is
// dropped silently rather than rejected — the failure mode CLAUDE.md warns about for a new role's
// letter, met here by using `ZZ-` in the first draft and getting an empty parse.
const entry = (needsLine: string) => [
  '## Queue',
  '### [platform] PS-9001 — a fixture entry',
  '- **Lane:** B',
  needsLine,
  '### [platform] PS-9002 — the entry the note mentions',
  '- **Lane:** B',
]

const needsOf = (needsLine: string) => {
  const entries = parseEntries(entry(needsLine))
  return entries.find((e: { id: string }) => e.id === 'PS-9001')!.needs
}

describe('a Needs: field that declares nothing parks on nothing', () => {
  it('reads no dependency from a clearing note that names the id it cleared', () => {
    expect(needsOf('- **Needs:** — nothing. ⚠ This said `PS-9002` until 2026-09-28, and it was INVERTED.'))
      .toEqual([])
  })

  it('reads no dependency from "separately buildable" prose', () => {
    expect(needsOf('- **Needs:** — nothing. Shares a cause with PS-9002 but is separately buildable.'))
      .toEqual([])
  })

  it('accepts "none" as well as "nothing"', () => {
    expect(needsOf('- **Needs:** none — PS-9002 covers the other half.')).toEqual([])
  })

  it('⛔ still reads a REAL dependency — the fix must not blind the field', () => {
    expect(needsOf('- **Needs:** PS-9002')).toEqual(['PS-9002'])
    expect(needsOf('- **Needs: PS-9002**')).toEqual(['PS-9002'])
  })

  it('still parks an entry whose separate Needs: line is real', () => {
    const entries = parseEntries([
      '## Queue',
      '### [platform] PS-9001 — two Needs lines, one real',
      '- **Needs: PS-9002**',
      '- **Lane:** B',
      '- **Needs:** nothing more.',
      '### [platform] PS-9002 — the blocker',
      '- **Lane:** B',
    ])
    const one = entries.find((e: { id: string }) => e.id === 'PS-9001')!
    expect(one.needs).toEqual(['PS-9002'])
    expect(parkReasons(one, new Set(['PS-9001', 'PS-9002']))).toEqual(['Needs: PS-9002'])
  })

  it('declaresNothing reads the declaration, not the prose after it', () => {
    for (const v of ['nothing', '— nothing.', 'none', '**nothing** to investigate', '- nothing, see PS-9002']) {
      expect(declaresNothing(v), v).toBe(true)
    }
    for (const v of ['PS-9002', 'PS-9002 — nothing else', 'the nothing-burger entry PS-9002']) {
      expect(declaresNothing(v), v).toBe(false)
    }
  })
})

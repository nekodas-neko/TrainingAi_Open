import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPaletteEntry, sessionPaletteIndex } from '../session-palette'

const program = [
  { name: 'Push A', position: 0 },
  { name: 'Pull A', position: 1 },
  { name: 'Legs', position: 2 },
]

// The hash the calendar and the weekly load bars each carried before they shared this function.
function legacyHash(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h
}

describe('sessionPaletteIndex', () => {
  it('uses the program position for a known session, whatever the case', () => {
    expect(sessionPaletteIndex('Pull A', program)).toBe(1)
    expect(sessionPaletteIndex('pull a', program)).toBe(1)
    expect(sessionPaletteIndex('LEGS', program)).toBe(2)
  })

  it('keeps the colour an old ad-hoc session already had', () => {
    for (const name of ['Run', 'Mobility', 'Old Upper Body', 'Pull A (old)', '']) {
      expect(sessionPaletteIndex(name, program)).toBe(legacyHash(name))
      expect(sessionPaletteIndex(name, [])).toBe(legacyHash(name))
    }
  })

  it('gives a known session the same palette entry on every surface', () => {
    for (const s of program) {
      expect(getPaletteEntry(sessionPaletteIndex(s.name, program))).toBe(getPaletteEntry(s.position))
    }
  })

  it('is the only copy of the name hash in the web surfaces', () => {
    const root = resolve(__dirname, '../../../..')
    for (const file of ['components/calendar-widget.tsx', 'components/stats/weekly-stats-hub.tsx']) {
      const source = readFileSync(resolve(root, file), 'utf8')
      expect(source, file).toContain('sessionPaletteIndex')
      expect(source, file).not.toMatch(/\*\s*31\s*\+\s*\w*\.?charCodeAt/)
    }
  })
})

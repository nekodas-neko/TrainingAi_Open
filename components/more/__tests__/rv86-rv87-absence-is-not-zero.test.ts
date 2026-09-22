import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** RV-86 / RV-87. Two screens rendered a failed fetch as a measured zero: the home Streak card
 *  painted "0 days, 0 / 5 sessions" from a `{}` that meant "the request failed", and the Profile
 *  tab painted "Level 1 · Novice · 0 XP" with a lifetime of zeros — best streak included — from a
 *  row of `?? 0` defaults. Both now carry a gate prop and render "—" while it is false.
 *
 *  Only the FIRST group below is load-bearing: a gate set from a failure path, or defaulted at a
 *  call site, puts the confident zero straight back without changing a single rendered line, and
 *  that is the shape a future edit is most likely to reach for. The rest pin the fix in place, so
 *  removing a guard has to be deliberate rather than incidental. */

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/** Source with comments stripped, so a gate named in prose is not mistaken for one in code. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('the gate can only be raised by a successful read', () => {
  it('streakLoaded is never set inside an error handler', () => {
    const src = code(read('app/session-select/session-select-content.tsx'))
    expect(src, 'setStreakLoaded is gone — RV-86 has been undone or renamed')
      .toContain('setStreakLoaded(true)')

    // Every `onError:` / `.catch(` handler in the file, up to the end of its own arrow body.
    for (const m of src.matchAll(/(?:onError\s*:|\.catch\s*\()/g)) {
      const window = src.slice(m.index, m.index + 400)
      expect(window, 'a failure path raises streakLoaded — absence would read as zero again')
        .not.toContain('setStreakLoaded(true)')
    }
  })

  it('the gate props are required, so a new call site cannot default them to true', () => {
    const cases: [string, string][] = [
      ['app/session-select/components/streak-card.tsx', 'loaded'],
      ['components/more/stats-grid.tsx', 'known'],
      ['components/more/achievements-section.tsx', 'countsKnown'],
    ]
    for (const [file, prop] of cases) {
      const src = code(read(file))
      expect(src, `${file} lost its ${prop} prop`).toMatch(
        new RegExp(`^[ \\t]*${prop}: boolean[;,]?[ \\t]*$`, 'm'),
      )
      expect(src, `${file}: ${prop} is optional — a call site that omits it renders zeros again`)
        .not.toMatch(new RegExp(`\\b${prop}\\?\\s*:`))
      expect(src, `${file}: ${prop} has a default — the same hole, one line lower`)
        .not.toMatch(new RegExp(`\\b${prop}\\s*=\\s*true`))
    }
  })
})

describe('the figures themselves stay behind their gate', () => {
  it('the streak card renders no history-derived number unguarded', () => {
    const src = code(read('app/session-select/components/streak-card.tsx'))
    for (const bare of ['{streak}', '{weekSessionCount}']) {
      expect(src, `${bare} is rendered raw — a failed fetch paints it as a real count`)
        .not.toContain(bare)
    }
    expect(src).toContain('{loaded && streak > 0 ? streak : "—"}')
    expect(src).toContain('{loaded ? weekSessionCount : "—"}')
  })

  it('every lifetime stat tile goes through the gate', () => {
    const src = code(read('components/more/stats-grid.tsx'))
    for (const raw of [
      '{totalSessions}', '{totalSets.toLocaleString()}', '{formatVolume(totalVolumeKg)}',
      '{bestStreak}', '{formatDistance(totalDistanceKm)}',
    ]) {
      expect(src, `${raw} is rendered raw — a ?? 0 default reaches the screen as a fact`)
        .not.toContain(raw)
    }
    expect(src.match(/\bshow\(/g) ?? [], 'all five tiles go through show()').toHaveLength(5)
  })
})

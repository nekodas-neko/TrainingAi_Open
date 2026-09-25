import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** RV-102, the two halves that change nothing on screen.
 *
 *  `CARD_DEFAULT_COLORS` was declared twice: the canonical table the cards render from, and a
 *  private copy in the settings picker that supplied its swatches. Nothing was broken — the ten
 *  shared keys held identical values — but an edit to either would have shown the owner a swatch
 *  the card does not honour, with no test tying them together. (The entry called the two
 *  "identical"; they were not. The canonical one carries three extra keys for cards that are not
 *  widgets, which is why the picker could not simply be pointed at it without checking that it
 *  iterates its own `CARD_WIDGET_DEFS` rather than the table's keys. It does.)
 *
 *  And `--chart-1`…`--chart-5` were shadcn defaults with no consumer anywhere, one of which
 *  (`--chart-1`, 2.72:1 against `--card`) could not have been adopted without failing the 3:1 UI
 *  floor. Five dead tokens that cannot be used are worse than none, because they read as the
 *  palette a future chart should reach for. */

const ROOT = path.resolve(__dirname, '../..')
const SELF = 'app/__tests__/rv102-one-card-colour-table.test.ts'

// `git ls-files a b -- '*.ts'` UNIONS its pathspecs rather than filtering, and this file names both
// of the things it is banning — so it would flag itself. Filter in JS, not in git.
const sourceFiles = () =>
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx|css)$/.test(f) && f !== SELF)

describe('RV-102 — one card-colour table, and no dead chart tokens', () => {
  it('CARD_DEFAULT_COLORS is declared exactly once, in the canonical file', () => {
    const declarers = sourceFiles().filter((f) =>
      /^\s*(?:export\s+)?const CARD_DEFAULT_COLORS\b/m.test(readFileSync(path.join(ROOT, f), 'utf8')),
    )
    expect(declarers).toEqual(['app/session-select/constants.ts'])
  })

  it('every other user of it imports that one', () => {
    // Guards the case where a second copy is introduced under a different name: the picker and the
    // cards must resolve to the same module.
    const users = sourceFiles().filter((f) =>
      readFileSync(path.join(ROOT, f), 'utf8').includes('CARD_DEFAULT_COLORS'),
    )
    expect(users.length, 'nothing uses the table — this test would pass vacuously').toBeGreaterThan(2)
    for (const f of users) {
      if (f === 'app/session-select/constants.ts') continue
      expect(readFileSync(path.join(ROOT, f), 'utf8'), `${f} uses the table without importing it`)
        .toMatch(/import \{[^}]*CARD_DEFAULT_COLORS[^}]*\} from/)
    }
  })

  it('no --chart-N token is defined or referenced anywhere', () => {
    const offenders: string[] = []
    for (const f of sourceFiles()) {
      readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
        if (/--(?:color-)?chart-[1-5]\b/.test(line)) offenders.push(`${f}:${i + 1} ${line.trim()}`)
      })
    }
    expect(offenders, 'a chart token is back — give it a consumer and a contrast check, or drop it; '
      + '--chart-1 measured 2.72:1 against --card, under the 3:1 floor for a UI colour').toEqual([])
  })
})

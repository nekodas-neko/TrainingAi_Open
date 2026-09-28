import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const ROOT = path.resolve(__dirname, '../../..')
const src = stripComments(readFileSync(path.join(ROOT, 'components/nutrition/supplements-section.tsx'), 'utf8'))

/**
 * RV-207 ③ — ticking a second supplement while the first was still writing did nothing.
 *
 * `toggleLog` opened with `if (toggling) return` against a `string | null`, so the guard — which
 * exists to stop a double-tap on ONE row — applied to the whole screen. The second tick was
 * swallowed with no error and no visual change, which is the worst shape a dropped write can take.
 *
 * There is no DOM project in this suite, so this is a source assertion. What it pins is the part
 * that regresses: the guard being per-id rather than global, in all four places that state is read
 * or written. A reviewer restoring any one of them reintroduces the bug.
 */
describe('RV-207 — the in-flight guard is per supplement, not per screen', () => {
  it('holds a Set of ids rather than one id', () => {
    expect(src).toMatch(/useState<ReadonlySet<string>>/)
    expect(src).not.toMatch(/useState<string \| null>\(null\)[\s\S]{0,40}toggling/)
  })

  it('the early return asks about THIS supplement', () => {
    expect(src).toMatch(/if \(toggling\.has\(s\.id\)\) return/)
    // The global form is the bug. It must not come back in either spelling.
    expect(src).not.toMatch(/if \(toggling\) return/)
  })

  it('adds and removes the id rather than replacing the whole value', () => {
    expect(src).toMatch(/setToggling\(prev => new Set\(prev\)\.add\(s\.id\)\)/)
    expect(src).toMatch(/next\.delete\(s\.id\)/)
    // `setToggling(null)` in the finally would clear every OTHER row's in-flight mark too.
    expect(src).not.toMatch(/setToggling\(null\)/)
  })

  it('disables only the row being written', () => {
    expect(src).toMatch(/disabled=\{toggling\.has\(s\.id\)\}/)
  })
})

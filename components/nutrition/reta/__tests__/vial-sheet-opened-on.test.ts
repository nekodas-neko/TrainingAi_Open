import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../../scripts/lib/strip-comments.js'

// Split from the vial-date tests when `vial-date` moved to `@trainingai/shared` (#3041): this one
// reads the sheet's own source, so it stays beside the sheet.

/**
 * BF-136's regression, read off the source: the POST body must carry the field the form collects,
 * not a constant. Nothing renders in a test runner, and the defect was a single argument.
 */
describe('the sheet sends the date the user chose', () => {
  const ROOT = path.resolve(__dirname, '../../../..')
  const raw = readFileSync(path.join(ROOT, 'components/nutrition/reta/vial-sheet.tsx'), 'utf8')
  /** Comments quote the old call while explaining the bug, so a raw match would pass on prose. */
  const code = stripComments(raw)

  it('does not hardcode openedOn to today in the request body', () => {
    expect(code).not.toMatch(/openedOn:\s*todayInTz\(/)
    expect(code).toMatch(/\.\.\.draft,\s*openedOn\s*\}/)
  })

  it('renders a control for it, bounded', () => {
    expect(code).toMatch(/id="vial-opened"/)
    expect(code).toMatch(/type="date"/)
    expect(code).toMatch(/min=\{openedBounds\.min\}/)
    expect(code).toMatch(/max=\{openedBounds\.max\}/)
  })

  it('defaults the new-vial date to today rather than inheriting the last vial\'s', () => {
    // Inheriting would reproduce the defect one vial along, and silently.
    expect(code).toMatch(/setOpenedOn\(today\)/)
    expect(code).not.toMatch(/setOpenedOn\(current/)
  })

  it('will not save an out-of-range date', () => {
    expect(code).toMatch(/openedProblem/)
    expect(code).toMatch(/disabled=\{saving \|\| concentration == null \|\| openedProblem != null\}/)
  })
})

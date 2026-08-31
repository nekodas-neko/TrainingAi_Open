import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

/**
 * BF-73 / BF-74 — the two things in this batch that would regress silently.
 *
 * Both are source-level on purpose. Neither defect is visible in a passing render: an accessible
 * name that says the wrong thing renders identically, and a destructive control in the dismiss
 * corner renders identically to one anywhere else. What made them defects was *where* and *what
 * they said*, which is what these read.
 */
describe('nutrition uplift', () => {
  it('BF-74: the photo remove control is not in the sheet-dismiss corner', () => {
    const src = read('components/nutrition/meal-photo-tile.tsx')
    const button = src.slice(src.indexOf('const removeButton'), src.indexOf('const pickProps'))

    // `meal-detail-sheet` passes `hideCloseButton`, so this was the only ✕ on the screen and it sat
    // top-right — the corner a reach for "close" lands on. The position IS the defect; size was not.
    expect(button, 'a destructive control must not sit where the close button would').not.toMatch(/top-0/)
    expect(button).toMatch(/bottom-0 right-0/)
  })

  it('BF-74: removing a photo is undoable and clears the tap floor', () => {
    const src = read('components/nutrition/meal-photo-tile.tsx')
    const button = src.slice(src.indexOf('const removeButton'), src.indexOf('const pickProps'))

    // The parent saves immediately, so without this a mis-tap loses the photo. Undo is cheaper than
    // a confirm dialog and does not stand between the user and the common case.
    expect(button, 'the parent saves at once — a mis-tap must be recoverable').toMatch(/Undo/)
    // 44 dp on the hero, which is the only variant with call sites.
    expect(button).toMatch(/h-11 w-11/)
    // A bin, not an ✕: the glyph is half of why it now reads as removal rather than dismissal.
    expect(button).toMatch(/Trash2/)
  })

  it('BF-73: the meal bin keeps the words BF-50 gave it, in its accessible name', () => {
    const src = read('components/nutrition/meal-list-actions.tsx')

    // BF-50 ④ renamed this control from `Select` to `Delete meals` because the owner could not tell
    // what the mode was for. Going icon-only throws the words away visually, so the accessible name
    // is the only thing still carrying that fix — `aria-label="Delete"` would quietly undo it.
    expect(src).toMatch(/aria-label="Delete meals"/)
    expect(src, 'an icon-only control must still be a 44 dp target').toMatch(/h-11 w-11/)
  })

  it('BF-73: the capture tiles have no fixed height, so a wrapped label cannot clip', () => {
    const src = read('components/nutrition/capture-actions.tsx')
    // From the `actions` array, because the icon size lives there rather than in the JSX below.
    const tiles = src.slice(src.indexOf('const actions = ['), src.indexOf('Or choose a photo'))

    // "Describe or enter" wraps to two lines in a third of 412 dp, and `h-[Npx]` clips the second.
    // This is the only half of the tile's sizing a test can hold: the height itself comes from
    // padding, because `min-h-[Npx]` is INERT on a button — `globals.css` sets a bare
    // `button { min-height: 48px }` that beats the utility (measured: 48px on a button, 84px on a
    // div with the same class). Asserting a `min-h` here would assert something that does nothing,
    // which is how BF-50's "62 px" comment came to describe a tile that measured 60. See LB-32.
    expect(tiles, 'a fixed height clips the two-line label').not.toMatch(/\sh-\[\d+px\]/)
    expect(tiles, 'the height is padding-driven; py-3.5 is what makes it 79px').toMatch(/py-3\.5/)
    expect(tiles, 'the icon grew with the box — a small glyph in a big box reads as empty').toMatch(/h-7 w-7/)
  })
})

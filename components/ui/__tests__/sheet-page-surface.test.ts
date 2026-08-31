import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

/**
 * BF-75 — the sheet surface, guarded at the source.
 *
 * Source-level because both vitest projects run `environment: 'node'`, so nothing renders. What
 * these hold are the three ways this change can go wrong while still compiling, and one of them
 * produces a completely blank sheet rather than a subtle one.
 */
describe('sheet page surface', () => {
  const sheet = () => read('components/ui/sheet.tsx')

  it('paints the palette BEHIND the content, not over it', () => {
    const layer = sheet().slice(sheet().indexOf('function SheetSurfaceLayer'), sheet().indexOf('function SheetContent'))

    // **The one that renders a blank sheet.** `SheetContent` is `fixed z-50`, which establishes a
    // stacking context; inside it a positioned child with no z-index paints ABOVE the non-positioned
    // content, so the gradient would cover every row of the sheet. `-z-10` puts it above the sheet's
    // own background and below its children, which is the only correct place for it.
    expect(layer, 'without a negative z-index this layer covers the sheet content').toMatch(/-z-10/)
    expect(layer).toMatch(/absolute inset-0/)
    // Clipped to the sheet's own corner radius — several nutrition sheets pass `rounded-t-2xl`, and
    // a square gradient under a rounded sheet shows its corners.
    expect(layer).toMatch(/rounded-\[inherit\]/)
    // Never intercepts a tap: it spans the whole sheet.
    expect(layer).toMatch(/pointer-events-none/)
  })

  it('keeps the readability scrim, which is what makes it shippable', () => {
    const layer = sheet().slice(sheet().indexOf('function SheetSurfaceLayer'), sheet().indexOf('function SheetContent'))
    // These sheets are dense — macro numbers, ingredient rows, small grey secondary text — and body
    // text has to hold 4.5:1 over whatever the gradient does. A raw gradient behind live text is the
    // exact thing the repo's background rule forbids.
    expect(layer, 'a raw gradient behind live text fails the contrast rule').toMatch(/ScrimLayer/)
    // The palette comes from the shared token helper, never a literal: the gradients live in
    // globals.css under `:root`/`.dark` so the cascade picks the variant.
    expect(layer).toMatch(/screenPaletteVar/)
  })

  it('is opt-in, and only the nutrition sheets opted in', () => {
    // `SheetContent` is the app-wide primitive — every sheet in every tab renders through it — so a
    // default of "page" would be the "no global element-selector styling" hazard wearing a
    // component's clothes. BF-75 names the surface it wanted changed; this keeps it there.
    expect(sheet()).toMatch(/surface = "default"/)

    // CALL SITES: a file that renders `<SheetContent` and passes the prop. Matching the bare string
    // would also hit `sheet.tsx` itself, where it appears in the prop's own documentation, and this
    // test file — the same comment-versus-code trap that made a guard in the previous batch pass
    // against its own explanation.
    const files = fs.readdirSync(path.join(root, 'components'), { recursive: true, encoding: 'utf8' })
      .filter(f => f.endsWith('.tsx'))
      .filter(f => {
        const src = read(path.join('components', f))
        return src.includes('<SheetContent') && src.includes('surface="page"')
      })
      .map(f => f.replace(/\\/g, '/'))
      .sort()
    expect(files).toEqual([
      'nutrition/food-logger-sheet.tsx',
      'nutrition/meal-detail-sheet.tsx',
      'nutrition/quantity-sheet.tsx',
      'nutrition/quick-edit-log-sheet.tsx',
      'nutrition/saved-meals-sheet.tsx',
    ])
  })

  it('follows the wallpaper rather than deciding for itself', () => {
    const hook = read('lib/hooks/use-screen-surface.ts')
    // A sheet painting a gradient while the wallpaper behind it is switched off is a coloured panel
    // floating over a plain page — worse than the opaque sheet it replaced. The store ships
    // `enabled: false`, so this gate is the ordinary case rather than an edge one.
    expect(hook, 'the sheet must not paint when the wallpaper is off').toMatch(/!enabled/)
    expect(hook, 'and not when this screen’s own section is off').toMatch(/!sections\[section\]/)
    // Persisted store: its first render returns defaults, not the user's choice.
    expect(hook).toMatch(/!mounted/)
  })

  it('reads the routing from one place, not a second copy', () => {
    // Two copies would disagree the first time a route moved, and the failure is a sheet in one
    // colour over a page in another.
    const bg = read('components/dynamic-background/dynamic-background.tsx')
    expect(bg).toMatch(/from '@\/lib\/background\/pathname-routing'/)
    expect(bg, 'the wallpaper must not redefine the routing it shares').not.toMatch(/function pathnameToSection/)
    expect(bg).not.toMatch(/function pathnameToPaletteKey/)
  })
})

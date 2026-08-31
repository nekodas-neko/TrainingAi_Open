import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(e.name)) out.push(p)
  }
  return out
}

/**
 * A sheet must not announce its own title twice (LB-23).
 *
 * Radix needs a `SheetTitle` for the dialog's accessible name, and the obvious way to satisfy that
 * next to a styled header is to add an `sr-only` one beside the visible `<h2>`. Three sheets did.
 * A screen reader then reads the name once as the dialog's and again as a heading, and
 * `getByRole('heading', { name })` becomes ambiguous — which is why `day-review-one-door.spec.ts`
 * had to match on the dialog and leave a comment pointing at this entry.
 *
 * `<SheetTitle asChild><h2 …>` is the fix: one node, which *is* both. `SheetTitle` is already typed
 * as the Radix primitive's props, so `asChild` needs no change to `components/ui/sheet.tsx`.
 *
 * **An `sr-only` SheetTitle on its own is fine and stays legal.** `quick-edit-log-sheet.tsx` has
 * one, and its visible header is the food's name — a different string, so nothing is said twice.
 * That distinction is the whole rule, so this matches on the text rather than on the `sr-only`.
 */
describe('sheet titles', () => {
  it('no sheet renders an sr-only SheetTitle and a visible heading saying the same thing', () => {
    const offenders: string[] = []
    for (const abs of ['app', 'components'].flatMap(d => walk(path.join(root, d)))) {
      const src = fs.readFileSync(abs, 'utf8')
      for (const m of src.matchAll(/<SheetTitle[^>]*className="sr-only"[^>]*>([\s\S]*?)<\/SheetTitle>/g)) {
        const title = m[1].trim()
        if (!title) continue
        // The same expression inside a heading in the same file — a literal like `End of Day`, or an
        // interpolation like `{STEP_LABELS[step]}`, which is how food-logger-sheet said it twice.
        const heading = new RegExp(`<h[1-6][^>]*>\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</h[1-6]>`)
        if (heading.test(src)) {
          offenders.push(`${path.relative(root, abs).replace(/\\/g, '/')} — "${title}"`)
        }
      }
    }
    expect(
      offenders,
      'wrap the visible heading instead: <SheetTitle asChild><h2 …>…</h2></SheetTitle>',
    ).toEqual([])
  })
})

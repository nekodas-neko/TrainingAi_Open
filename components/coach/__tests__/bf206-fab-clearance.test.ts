import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

/**
 * BF-206 — a screen that mounts the Coach button must reserve the Coach button's height.
 *
 * `pb-nav-safe` reserves the bottom nav and a gutter. The FAB is `bottom-fab-safe` and `h-14`, so
 * its top edge sits **56 px above everything that padding reserved** — and the bottom 56 px of the
 * scroll, on the right, can never be scrolled clear of it. On the owner's screenshot that was the
 * day timeline's last row, sitting behind the button.
 *
 * The scan exists because the failure is silent and arrives by omission: the next screen to mount
 * a FAB will reach for `pb-nav-safe` like every other screen, and nothing will look wrong until
 * something lands under the button.
 */
const repoRoot = join(__dirname, '..', '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '__tests__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.tsx')) out.push(full)
  }
  return out
}

const sources = ['app', 'components']
  .flatMap(d => walk(join(repoRoot, d)))
  .map(f => ({ file: f.slice(repoRoot.length + 1), code: stripComments(readFileSync(f, 'utf8')) as string }))

describe('BF-206 — the Coach button and the space under it', () => {
  it('every screen that RENDERS the FAB also reserves its height', () => {
    const mounts = sources.filter(s => /<CoachFab\b/.test(s.code))
    expect(mounts.length, 'nothing renders CoachFab — the scan is looking at the wrong thing').toBeGreaterThan(0)
    for (const { file, code } of mounts) {
      expect(code, `${file} mounts the FAB but does not reserve its height with pb-fab-safe`)
        .toMatch(/\bpb-fab-safe\b/)
    }
  })

  it('a screen that reserves the FAB height does not also use the nav-only padding on that scroll', () => {
    // Both on one element would be a Tailwind specificity coin-toss, and the losing side is silent.
    for (const { file, code } of sources) {
      const bothOnOneClass = /class(?:Name)?="[^"]*\bpb-nav-safe\b[^"]*\bpb-fab-safe\b[^"]*"|class(?:Name)?="[^"]*\bpb-fab-safe\b[^"]*\bpb-nav-safe\b[^"]*"/
      expect(code, `${file} sets both paddings on one element`).not.toMatch(bothOnOneClass)
    }
  })

  it('pb-fab-safe is the nav padding PLUS the button, not a hand-picked number', () => {
    const css = readFileSync(join(repoRoot, 'app/globals.css'), 'utf8')
    const rule = /\.pb-fab-safe\s*\{\s*padding-bottom:\s*calc\(([^)]*\([^)]*\)[^)]*|[^)]*)\);?\s*\}/.exec(css)
    expect(rule, '.pb-fab-safe is not defined in globals.css').not.toBeNull()
    // 3.5rem twice: the nav's h-14 and the FAB's h-14. One of them is what BF-206 was missing.
    expect(rule![1].match(/3\.5rem/g) ?? []).toHaveLength(2)
    expect(rule![1]).toContain('safe-area-inset-bottom')
  })
})

describe('BF-206 — the Coach button says what it is', () => {
  it('carries a VISIBLE label, not only an aria-label', () => {
    // The owner asked what "that button on the widget, the white circle" was. A sparkle is this
    // app's generic AI mark — the weekly-recap banner, the meal-source row and the profile tab all
    // use it — so it names a category, not a destination. An aria-label is not an answer to that.
    const fab = stripComments(readFileSync(join(repoRoot, 'components/coach/coach-fab.tsx'), 'utf8')) as string
    expect(fab, 'the FAB lost its visible label and is iconic again').toMatch(/>\s*Coach\s*</)
    expect(fab).toMatch(/aria-label="Open AI Coach"/)
  })
})

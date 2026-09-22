import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Batch `layout-384` — RV-92, RV-93, RV-94, RV-95, RV-96. Five places where a 384px-class screen
 *  cut the wrong thing off. They share one verification, which is why they ship together.
 *
 *  Source-shape, because every one of them is a CSS class combination whose effect is geometric:
 *  jsdom has no layout engine, so a rendering test here would assert nothing. The device sitting
 *  is what confirms the pixels; this is what stops the class combination silently coming back. */

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('layout-384', () => {
  it('RV-92 — the exercise name truncates, and the done tick is not inside the truncating box', () => {
    const src = code(read('components/workout/pre-workout-screen.tsx'))
    // `truncate` sets text-overflow, which applies to inline content of a BLOCK container. On a
    // flex container the text becomes an anonymous flex item at min-width:auto: no ellipsis, no
    // shrink, a hard clip — and the CheckIcon after it clipped out of existence.
    expect(src, 'truncate is back on the flex container, where text-overflow does nothing')
      .not.toMatch(/className="[^"]*\btruncate\b[^"]*\bflex\b[^"]*"/)
    expect(src).toContain('<span className="truncate">{ex.name}</span>')
  })

  it('RV-93 — the injury chip yields before the exercise title does', () => {
    const src = code(read('components/workout/injury-notice.tsx'))
    // The icon and the four-letter "Swap" keep `shrink-0` and should: a 16px glyph and a word
    // that short have nothing to give. This asserts on the SHELL, which is the box that was
    // claiming the width — and on BOTH of its variants, because the first pass fixed the button
    // and missed the `role="status"` one beside it.
    expect(src, 'a chip shell is shrink-0 again — it takes 176 of 352px whatever the title needs')
      .not.toMatch(/\$\{shell\}\s+shrink-0/)
    expect(src, 'and it can shrink, which min-w-0 is what permits').toMatch(/const shell = "[^"]*\bmin-w-0\b/)
  })

  it('RV-94 — the food name is not cut at 22 characters', () => {
    const src = code(read('components/nutrition/food-row.tsx'))
    // 130 of 337 real items exceed the 162px name column. The secondary line does differ between
    // the colliding pair — 350 g vs 258 g — but only at its tail, which is what truncation removes,
    // so it never disambiguated them. Showing the whole name is what does.
    expect(src).toContain('<span className="block line-clamp-2 text-sm font-medium leading-snug">{name}</span>')
  })

  it('RV-95 — the Volume tile keeps its unit off the value line', () => {
    const src = code(read('components/stats/weekly-stats-hub.tsx'))
    // Scoped to the STAT_CARDS row: the bar labels above it also print "<n> kg" and are a
    // different element in a different layout, with room for it.
    const tile = /\{ label: "Volume",[^\n]*\n?[^\n]*/.exec(src.slice(src.indexOf('{ label: "Volume"')))
    expect(tile?.[0], 'the unit rides with the value again, and wraps in a 74px cell every real week')
      .not.toMatch(/toLocaleString\(\)\} kg`/)
    expect(src).toMatch(/unit:\s*"kg lifted"/)
  })

  it('RV-96 — the coverage count is not the first thing cut', () => {
    const src = code(read('components/workout/done-screen.tsx'))
    expect(src, 'name and coverage share one truncating span again — the caveat is lost first, and '
      + 'lost precisely on the longest names')
      .not.toMatch(/truncate max-w-\[55%\]/)
    expect(src).toMatch(/<span className="flex-none opacity-60">/)
  })
})

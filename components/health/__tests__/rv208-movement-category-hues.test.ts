import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SESSION_PALETTE } from '@trainingai/shared/session-palette'

/**
 * RV-208 ③ — a movement-category colour must never be a session colour.
 *
 * `SESSION_PALETTE` is indexed by session POSITION, so "Pull is green" is the owner's session
 * ORDER, not a name map — and Movement Balance sits a thumb's scroll below the calendar that uses
 * it. Before this, `legs` was `--accent-green` (**0°** from session green) and `pull` was
 * `--accent-purple` (**10°** from session purple): the same three words in two colour maps,
 * transposed rather than merely different.
 *
 * This asserts the arithmetic, not the literals, because the interesting failure is a future change
 * that reintroduces a colliding hue while looking perfectly reasonable in the diff.
 */

const SESSION_HUES: Record<string, number> = {
  red: 27, amber: 70, green: 145, blue: 255, indigo: 275, purple: 305,
}

/** Shortest distance around the 360° wheel. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
const CARD = readFileSync(join(process.cwd(), 'components/health/movement-balance-card.tsx'), 'utf8')

/** Every `--accent-*` hue as `app/globals.css` declares it. Both themes, so neither can drift alone. */
function accentHues(): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const m of CSS.matchAll(/--(accent-[a-z]+):\s*oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s*\)/g)) {
    const list = out.get(m[1]) ?? []
    list.push(Number(m[2]))
    out.set(m[1], list)
  }
  return out
}

/** The tokens `PATTERN_COLOR` actually uses, read from the source rather than restated here. */
function patternTokens(): string[] {
  const block = CARD.slice(CARD.indexOf('const PATTERN_COLOR'), CARD.indexOf('export function MovementBalanceCard'))
  return [...block.matchAll(/var\(--(accent-[a-z]+)\)/g)].map(m => m[1])
}

describe('movement-category colours', () => {
  it('reads its tokens from globals.css, so the test cannot pass against a stale palette', () => {
    const hues = accentHues()
    expect(hues.size, 'no --accent-* tokens parsed — the regex has drifted from globals.css').toBeGreaterThan(3)
    const used = patternTokens()
    expect(used.length, 'no accent token found in PATTERN_COLOR').toBeGreaterThan(0)
    for (const t of used) expect(hues.has(t), `${t} is not declared in globals.css`).toBe(true)
  })

  it('keeps every category hue clear of every session hue, in BOTH themes', () => {
    const hues = accentHues()
    // 10° is what `pull` sat at and is indistinguishable in use; 25° is the floor this asserts,
    // comfortably below the ~45° the surviving choice actually has, so an honest re-colour has room.
    const MIN_GAP = 25
    for (const token of new Set(patternTokens())) {
      for (const hue of hues.get(token)!) {
        for (const [name, sessionHue] of Object.entries(SESSION_HUES)) {
          expect(
            hueGap(hue, sessionHue),
            `${token} (${hue}°) is ${hueGap(hue, sessionHue)}° from session ${name} (${sessionHue}°) — ` +
            'the calendar and this card would show the same words in near-identical colours',
          ).toBeGreaterThanOrEqual(MIN_GAP)
        }
      }
    }
  })

  it('never colours a category with a session-palette colour NAME either', () => {
    // The belt to the braces above: `bg-green-500` would collide without going through a token.
    const names = SESSION_PALETTE.map(p => p.color)
    const block = CARD.slice(CARD.indexOf('const PATTERN_COLOR'), CARD.indexOf('export function MovementBalanceCard'))
    for (const n of names) {
      expect(block.includes(`-${n}-`), `PATTERN_COLOR uses the session colour "${n}" directly`).toBe(false)
    }
  })

  it('carries no verdict: no category is green or red', () => {
    // The card states a balance, not a judgement. Green/red would read as good/bad, and both are
    // session hues anyway — so this is the same rule from the other direction.
    const block = CARD.slice(CARD.indexOf('const PATTERN_COLOR'), CARD.indexOf('export function MovementBalanceCard'))
    for (const banned of ['accent-green', 'accent-red', 'destructive']) {
      expect(block.includes(banned), `${banned} implies a verdict this card does not make`).toBe(false)
    }
  })
})

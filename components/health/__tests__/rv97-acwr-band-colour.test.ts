import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { acwrBand, acwrBandByKey } from '@trainingai/shared/ai-periodization/acwr'

/** RV-97. The ACWR headline was `style={{ color: '#f59e0b' }}` — a literal that is exactly what
 *  `acwrBand()` reserves for the **high** band. The band WORD beside it came from the real
 *  `interpretation`, so an ACWR of 1.05 rendered "✓ Optimal zone" with the number in warning
 *  amber, directly above body copy calling 0.8–1.3 the green zone. The card contradicted itself
 *  twice on one line, and `acwrBandByKey()` had existed for this caller the whole time.
 *
 *  **Only the first case discriminates, and it is stated rather than implied.** Run against the
 *  unfixed card, 1 of these 4 goes red. The second guards a WRONG fix (re-banding the raw number
 *  at the call site, which is what `acwrBand` was extracted to end) and passes on the unfixed
 *  card because it does not band at all. The last two characterise the shared helper and would
 *  pass either way — they are here because the card's body copy makes a promise about 0.8–1.3
 *  that nothing else checks. */

const ROOT = path.resolve(__dirname, '../../..')
const CARD = 'components/health/training-load-card.tsx'
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('RV-97 — the ACWR value is painted by its own band', () => {
  it('the headline takes no hard-coded colour', () => {
    const src = code(readFileSync(path.join(ROOT, CARD), 'utf8'))
    // Scoped to the headline. `monotonyColor` legitimately holds the three literals: it bands a
    // DIFFERENT metric on its own scale, and no shared helper exists for it.
    const headline = /className="text-3xl font-bold tabular-nums"[\s\S]{0,200}/.exec(src)?.[0] ?? ''
    expect(headline, 'the headline is back on a literal').not.toMatch(/#[0-9a-f]{6}/i)
    expect(headline).toMatch(/acwrBandByKey\(/)
  })

  it('and it reads the band by key rather than re-deriving thresholds', () => {
    const src = code(readFileSync(path.join(ROOT, CARD), 'utf8'))
    expect(src, 'the card re-bands the raw number itself — four divergent threshold sets is what '
      + 'acwrBand was extracted to end')
      .not.toMatch(/acwrBand\(\s*trainingLoad/)
  })

  it('every band the card can reach has its own colour, and they are all distinct', () => {
    const keys = ['low', 'optimal', 'high', 'very_high'] as const
    const colours = keys.map(k => acwrBandByKey(k).color)
    expect(new Set(colours).size, 'two bands share a colour — the card cannot distinguish them')
      .toBe(keys.length)
    // The specific confusion RV-97 found: optimal must not be the amber the literal hard-coded.
    expect(acwrBandByKey('optimal').color).not.toBe('#f59e0b')
    expect(acwrBandByKey('high').color).toBe('#f59e0b')
  })

  it('an ACWR inside the copy\'s own green zone bands as optimal', () => {
    // The body copy at `:91` promises 0.8–1.3 is green. This is that promise, asserted.
    for (const acwr of [0.8, 1.0, 1.05, 1.3]) {
      expect(acwrBand(acwr).key, `${acwr} is outside the zone the card's own copy promises`)
        .toBe('optimal')
    }
    expect(acwrBandByKey(acwrBand(1.05).key).color).toBe(acwrBand(1.05).color)
  })
})

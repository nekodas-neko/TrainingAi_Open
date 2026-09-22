import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** RV-98. `scripts/check-contrast.js` validated ten BARE token pairs and had no opacity handling,
 *  so `text-muted-foreground/60` and below were entirely unguarded. Measured over `--card`:
 *  70% opacity gives 4.64:1 and passes; 60% gives 3.73, 50% 2.97, 40% 2.34 and 30% 1.83, against
 *  an AA floor of 4.5:1. (Written as percentages, not as the Tailwind suffix: that suffix begins
 *  with a slash, and preceded by the bold marker it closes this very comment.)
 *  Forty-nine call sites sat below /70.
 *
 *  The script is the enforcement and runs in Custom Rules. This is the half the script cannot be:
 *  an independent statement of the floor, so a change that loosens the SCRIPT does not also erase
 *  the rule it was enforcing. */

const ROOT = path.resolve(__dirname, '../..')

describe('RV-98 — opacity-modified text stays above the AA floor', () => {
  it('no text token sits below /70 outside the script\'s exempt list', () => {
    // **Both filters are load-bearing and neither is obvious.** `git ls-files app components --
    // '*.tsx'` does NOT filter: git unions the three pathspecs, so `app` and `components` match
    // everything beneath them and `.ts` files come back too. And a test that states this rule has
    // to quote the banned token to state it — this file does, in its own header — so it lands in
    // its own scan the moment it is committed. RV-91's Cal/kcal sweep went red in CI for exactly
    // that, and this one did too, locally, before it shipped.
    const files = execFileSync('git', ['ls-files', 'app', 'components'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(f => f.endsWith('.tsx') && !f.includes('__tests__'))

    // Read the exempt list OUT of the script rather than restating it, so the two cannot drift:
    // a site removed there must be fixed here, and one added there needs its reason written there.
    const script = readFileSync(path.join(ROOT, 'scripts/check-contrast.js'), 'utf8')
    const exemptBlock = /const OPACITY_EXEMPT = new Map\(\[([\s\S]*?)\]\);/.exec(script)?.[1] ?? ''
    const exempt = new Set([...exemptBlock.matchAll(/\['([^']+)',/g)].map(m => m[1]))
    expect(exempt.size, 'the exempt list did not parse — this test would pass vacuously').toBe(4)

    const RE = /text-(?:muted-foreground|foreground|card-foreground)\/([0-9]{1,3})\b/g
    const offenders: string[] = []
    for (const f of files) {
      if (exempt.has(f)) continue
      readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
        for (const m of line.matchAll(RE)) {
          if (parseInt(m[1], 10) < 70) offenders.push(`${f}:${i + 1} ${m[0]}`)
        }
      })
    }
    expect(offenders, 'below /70 is below 4.5:1 over --card — raise it, or exempt it in the script '
      + 'WITH a reason if it is genuinely decorative or an inactive control').toEqual([])
  })

  it('the calendar rest marker is at FULL opacity, not merely at the floor', () => {
    // It is `text-[7px]` and the only thing distinguishing a past rest day from a past untracked
    // one in the month grid, so it gets 8.36:1 rather than the 4.64:1 that merely clears AA.
    const src = readFileSync(path.join(ROOT, 'components/calendar-widget.tsx'), 'utf8')
    expect(src).toMatch(/text-\[7px\][^"]*text-muted-foreground(?!\/)/)
  })

  it('the script itself still passes, and says it checked the opacity floor', () => {
    // Guards the vacuous case: a script that silently stops scanning would leave both the rule and
    // the first assertion above intact while enforcing nothing in CI.
    const out = execFileSync('node', ['scripts/check-contrast.js'], { cwd: ROOT, encoding: 'utf8' })
    expect(out).toMatch(/opacity-modified text is at or above \/70/)
  })
})

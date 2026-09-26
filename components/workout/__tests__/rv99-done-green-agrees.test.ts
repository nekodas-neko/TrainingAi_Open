import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const DIR = path.resolve(__dirname, '..')
const strip = (s: string) =>
  stripComments(s)
const files = readdirSync(DIR).filter(f => /\.tsx?$/.test(f))
const src = (f: string) => strip(readFileSync(path.join(DIR, f), 'utf8'))

/** `#22c55e`, `#22c55e88`, `rgb(34,197,94)`, `rgba(34, 197, 94, .1)` — one green, four spellings. */
const GREEN_HEX = /#22c55e|rgba?\(\s*34\s*,\s*197\s*,\s*94\s*[,)]/i
/** The states this file is about: a phase the user has finished. */
const DONE = /\b(?:is)?[dD]one\b|warmupDone|Complete\b/

/**
 * RV-99 — one "finished" green across the workout flow, not two.
 *
 * The workout-clocks slice migrated `GetReadyProgress`'s "✓ Ready" and `WarmupRampProgress`'s done
 * segments to `var(--accent-green)` and left `warmup-screen.tsx`'s "✓ Warm up complete" on
 * `#22c55e` — the same state, the same ✓-label-plus-filled-bar idiom, in two greens
 * (`rgb(34,197,94)` against the token's `rgb(86,238,102)`) one screen apart in a flow the user walks
 * through in seconds. Not simultaneous, which is why the first sweep missed it: the modes are
 * exclusive, so nothing puts the two on screen together and only the sequence exposes them.
 *
 * So this guards the class rather than the two files: **no screen in the workout flow may pick a
 * green by a "done" condition using a hex literal.** The next screen to paint a finished phase
 * inherits the answer instead of re-deciding it.
 *
 * It deliberately does NOT ban the hex outright. `#ef4444` for rest-overtime is untouched across
 * `rest-ring.tsx`, `last-set-rest-timer.tsx` and `workout-clocks.tsx` — three files agreeing on one
 * value, so there is nothing to fix and migrating it would be a restyle nobody asked for. The whole
 * of RV-99's remaining Lane B question is a *preference* pending the owner (`LB-152`); a
 * disagreement is the part that is a defect regardless of how he answers it, because one of the two
 * values is wrong either way.
 */
describe('RV-99 — the workout flow paints "finished" in one green', () => {
  it('finds the flow it is scanning', () => {
    // A rename that empties the glob would make every assertion below pass vacuously.
    expect(files).toContain('warmup-screen.tsx')
    expect(files).toContain('workout-clocks.tsx')
  })

  it('no file selects a green by a done-condition with a hex literal', () => {
    const offenders: string[] = []
    for (const f of files) {
      src(f).split('\n').forEach((line, i) => {
        // Both on one line is the whole shape: a ternary, or a `return X ? green : …`. A green
        // constant with no condition near it is an identity tint and is not this class.
        if (GREEN_HEX.test(line) && DONE.test(line)) offenders.push(`${f}:${i + 1} ${line.trim()}`)
      })
    }
    expect(offenders, 'the done green is var(--accent-green) across this flow').toEqual([])
  })

  it('both surfaces still paint their finished state, and with the token', () => {
    // Without this the test above passes on a file that simply stopped colouring the state.
    const warmup = src('warmup-screen.tsx')
    expect(warmup).toMatch(/warmupDone \? "var\(--accent-green\)"/)
    expect(warmup, 'the bar fill, not only the label').toMatch(/warmupDone\s*\n?\s*\?\s*"var\(--accent-green\)"/)
    expect(warmup, 'the glow carries its own 53%, from #22c55e88')
      .toMatch(/color-mix\(in oklch, var\(--accent-green\) 53%, transparent\)/)
    expect(src('workout-clocks.tsx')).toMatch(/done \? "var\(--accent-green\)"/)
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { illnessAdvisory } from '@trainingai/shared/health/illness-radar'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

/**
 * TN-45 — the only illness band that has ever fired had no UI.
 *
 * `watch` carries no readiness penalty, so nothing on Home moved and nothing said anything: two
 * real firings (2026-09-16 score 41, 2026-08-27 score 57) reached the owner as silence. The engine
 * half shipped the copy 2026-09-18; the render guard still returned `null` for `watch`.
 *
 * Asserted on CODE, not on mentions — the component's docstring discusses `watch` at length, and a
 * guard that matched the word would pass on the docstring alone (the Q-231 shape).
 */

const ROOT = path.resolve(__dirname, '../../..')
const SRC = stripComments(
  readFileSync(path.join(ROOT, 'components/home/illness-advisory-banner.tsx'), 'utf8'))

describe('TN-45 — the watch band reaches Home', () => {
  it('⭐ the engine half produces a line that names what moved', () => {
    // Verified against the biomarker maps as persisted in production for both real firings; this
    // pins the sentence the surface now renders.
    const line = illnessAdvisory('watch', {
      restingHr: { z: 2.4, value: 58, baseline: 52 },
      hrv: { z: -2.1, value: 38, baseline: 55 },
    } as never)
    expect(line).toMatch(/drifting from your baseline/)
    // ⛔ TN-46: the 2026-09-16 firing was Retatrutide, not illness. The copy must name what moved
    // and never imply infection — on any band, since one wording feeds every surface.
    for (const flag of ['watch'] as const) {
      expect(illnessAdvisory(flag, undefined)).not.toMatch(/infect|ill|sick|fever/i)
    }
  })

  it('⭐ the render guard no longer drops `watch` on the floor', () => {
    // The defect, in one line of source: an early return that named `watch` as not-rendered.
    expect(SRC, 'the banner returns null for watch again')
      .not.toMatch(/illnessFlag\s*!==\s*["']elevated["'][\s\S]{0,80}return null[\s\S]{0,200}illnessFlag\s*===\s*["']watch["']/)
    expect(SRC, 'no branch renders the watch band').toMatch(/illnessFlag\s*===\s*["']watch["']/)
  })

  it('renders the SHARED copy rather than a second wording of it', () => {
    // One sentence, one place. A literal here is the drift RV-208 is about, and worse: TN-46's
    // constraint would then have two homes and only one of them under test.
    const watchBranch = SRC.slice(SRC.indexOf("illnessFlag === \"watch\""))
    expect(watchBranch).toMatch(/\{readiness\.illnessAdvisory\}/)
    expect(watchBranch.slice(0, 400), 'the watch tier hard-codes a sentence')
      .not.toMatch(/baseline|drifting|keeping an eye/i)
  })

  it('⛔ and shows no band LABEL in the quiet tier', () => {
    // The prominent tier prints `elevated`/`fever`, which mean something to a reader. "Watch"
    // beside a neutral sentence reads as an instruction the band does not carry — `watch` has a
    // readiness penalty of ZERO.
    const watchBranch = SRC.slice(SRC.indexOf("illnessFlag === \"watch\""), SRC.indexOf('role="status"'))
    expect(watchBranch).not.toMatch(/\{readiness\.illnessFlag\}/)
    expect(watchBranch).not.toMatch(/illnessSuppression/)
  })

  it('keeps the prominent tier a live region and the quiet one not', () => {
    // A bordered advisory that appears is a status change worth announcing. An ambient note under
    // the scores is not, and a second live region on Home would announce on every load.
    expect(SRC).toMatch(/role="status"/)
    const watchBranch = SRC.slice(SRC.indexOf("illnessFlag === \"watch\""), SRC.indexOf('role="status"'))
    expect(watchBranch).not.toMatch(/role=/)
  })

  it('uses the type-scale token at the 11px floor, not a literal', () => {
    // RV-209 made `--text-2xs: 11px` the floor of the scale. Its guard only scans
    // `components/workout/`, so nothing would have stopped a `text-[11px]` here.
    const watchBranch = SRC.slice(SRC.indexOf("illnessFlag === \"watch\""), SRC.indexOf('role="status"'))
    expect(watchBranch).toMatch(/text-2xs/)
    expect(watchBranch).not.toMatch(/text-\[\d+px\]/)
  })
})

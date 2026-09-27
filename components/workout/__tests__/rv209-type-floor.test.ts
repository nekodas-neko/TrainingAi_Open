import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * RV-209 — the type scale has a floor now, and this is what keeps it.
 *
 * The tree had **42 font sizes** — 13 named plus 29 arbitrary ones (`text-[10.5px]`, `[11.5px]`,
 * `[12.5px]`…) from 7 px to 34 px — and **1,035 uses under 12 px**: 583 at 10, 287 at 11, 128 at
 * 9, down to 7. There was no token below `text-xs`, so every one of them was a per-site decision
 * written as a literal, which is how a scale grows half-pixel steps.
 *
 * `--text-2xs: 11px` is the floor. The nine sites the entry named on the workout screens — read at
 * arm's length, mid-set — are on it. **The rest is frozen rather than swept**, per file and
 * shrink-only: a hundred blind edits across twenty-four files is a worse risk than a ratchet that
 * makes every future touch pay a little of it down.
 *
 * To lower a number here, convert that file's literals and re-run. The numbers only go down.
 */
const DIR = join(__dirname, '..')

/** `text-[7px]`…`text-[10.5px]` — below the floor. */
const BELOW_FLOOR: Record<string, number> = {
  'active-workout-screen.tsx': 3,
  'added-weight-toggle.tsx': 1,
  'ai-prescription-card.tsx': 7,
  'deload-toggle.tsx': 1,
  'done-screen.tsx': 12,
  'exercise-hr-trend-card.tsx': 16,
  'exercise-stats-sheet.tsx': 4,
  'exercise-summary-screen.tsx': 11,
  'hr-recovery-chart.tsx': 2,
  'last-set-rest-timer.tsx': 1,
  'live-hr-chart.tsx': 3,
  'muscle-recovery-card.tsx': 4,
  'next-workout-card.tsx': 6,
  'one-rm-calculator-dialog.tsx': 1,
  'pip-view.tsx': 3,
  'pre-workout-screen.tsx': 3,
  'role-chip.tsx': 1,
  'rpe-strip.tsx': 1,
  'session-duration-picker.tsx': 1,
  'sets-grid.tsx': 6,
  'time-summary-card.tsx': 4,
  'voice-log-button.tsx': 2,
  'warmup-screen.tsx': 3,
  'workout-clocks.tsx': 7,
}

/** `text-[11px]` — AT the floor, but written as a literal instead of `text-2xs`. */
const ELEVEN_PX_LITERAL: Record<string, number> = {
  'active-workout-screen.tsx': 2,
  'ai-baseline-banner.tsx': 1,
  'ai-prescription-card.tsx': 12,
  'done-screen.tsx': 2,
  'exercise-stats-sheet.tsx': 2,
  'exercise-summary-screen.tsx': 1,
  'injury-notice.tsx': 2,
  'live-hr-chart.tsx': 1,
  'rpe-strip.tsx': 1,
  'set-card.tsx': 6,
  'time-summary-card.tsx': 3,
  'warmup-screen.tsx': 4,
  'workout-clocks.tsx': 2,
  'workout-review-sheet.tsx': 2,
}

const count = (src: string, re: RegExp) => (src.match(re) ?? []).length
const files = readdirSync(DIR).filter(f => /\.tsx?$/.test(f))

describe('RV-209 — the type-scale floor', () => {
  it('has files to scan', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it.each(files)('%s adds nothing below the 11px floor', file => {
    const n = count(readFileSync(join(DIR, file), 'utf8'), /text-\[(?:[0-9]|10)(?:\.5)?px\]/g)
    const allowed = BELOW_FLOOR[file] ?? 0
    expect(n, `use text-2xs (11px) or text-xs — the floor is in app/globals.css's @theme`)
      .toBeLessThanOrEqual(allowed)
  })

  it.each(files)('%s adds no new text-[11px] literal — that is text-2xs now', file => {
    const n = count(readFileSync(join(DIR, file), 'utf8'), /text-\[11px\]/g)
    expect(n, 'the floor has a token; a literal at the same size keeps it off the scale')
      .toBeLessThanOrEqual(ELEVEN_PX_LITERAL[file] ?? 0)
  })

  it('the baselines only shrink — a stale entry here means the debt was paid, not that it grew', () => {
    for (const [file, n] of Object.entries({ ...BELOW_FLOOR })) {
      const real = count(readFileSync(join(DIR, file), 'utf8'), /text-\[(?:[0-9]|10)(?:\.5)?px\]/g)
      expect(real, `${file}: baseline says ${n}, file has ${real} — lower the baseline`).toBe(n)
    }
  })
})

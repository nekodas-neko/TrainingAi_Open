import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { intensityZoneForPct } from '@trainingai/shared/workout/intensity-zone'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
/** The card explains this bug in prose, so a raw-source match would pass on the comment. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/[^\n]*/g, '')

/**
 * BF-163 — the owner, on the same card: *"Is hypertrogpy the correct tag?"*
 *
 * **By the band's own definition it was, and that is the problem.** `intensityZoneForPct` maps %1RM
 * to a zone with no reference to reps, so his squat at **72.5%** is Hypertrophy and the chip is
 * correct. What contradicted it was the chip's own tooltip — `typically 8–12 reps` — sitting one
 * line above a prescription of **2×6**, a rep count the same table calls **Strength**.
 *
 * The load and the reps genuinely disagree at 72.5% × 6; the chip is not merely mislabelled. So the
 * fix is not to pick a side, which needs a rule the app does not have — it is for the chip to claim
 * only the thing it measures.
 */
describe('BF-163 — the intensity chip claims only the load band', () => {
  it('reproduces the contradiction the owner read, from the real prescription', () => {
    const zone = intensityZoneForPct(72.5)
    expect(zone.label).toBe('Hypertrophy')
    // The tooltip's old claim, against the 6 reps printed on the same line.
    expect(zone.reps).toBe('8–12 reps')
    // 6 reps is what the SAME table calls Strength — the two halves of one chip disagreeing.
    expect(intensityZoneForPct(80).reps).toBe('4–6 reps')
  })

  it('the tooltip no longer asserts a rep count', () => {
    const card = code('components/workout/ai-prescription-card.tsx')
    expect(card).not.toContain('zone.reps')
    expect(card).not.toContain('typically')
  })

  it('and it says what the band IS read from, rather than going silent', () => {
    // Dropping the clause without replacing it leaves a tooltip that only repeats the visible
    // label. The point of the fix is that a reader whose reps do not match the band's name can
    // see why — so the replacement has to name the input.
    const card = code('components/workout/ai-prescription-card.tsx')
    expect(card).toContain('named from load alone')
  })

  it('the band table is unchanged — `reps` stays for the Lane A answer', () => {
    // Judging load AND reps together is the better fix and needs `reps` to do it. Deleting the
    // field here would be a Lane A edit (packages/shared) and would foreclose that.
    const table = read('packages/shared/src/workout/intensity-zone.ts')
    expect(table).toContain('reps: string')
    expect(intensityZoneForPct(90).reps).toBe('1–4 reps')
    expect(intensityZoneForPct(60).reps).toBe('12–20 reps')
    expect(intensityZoneForPct(40).reps).toBe('15+ reps')
  })
})

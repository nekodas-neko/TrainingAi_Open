import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COLLAPSING_BANNERS } from '@/components/home/home-banner-keys'

/**
 * RV-119 — the severity split is the decision, and it is the one a tidy-up would quietly undo.
 *
 * The owner's instruction is explicit: *"Do NOT collapse all seven. The illness advisory and
 * early-deload are things he should see today; putting them in a dismissible strip beside an APK
 * banner makes them easy to miss. Split by severity."* Moving either of those two behind the strip
 * looks like consistency in a diff and is the failure this entry exists to prevent — so it fails
 * here instead.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const STACK = read('components/home/home-banner-stack.tsx')
const PARENT = read('app/session-select/session-select-content.tsx')

/** Everything inside the collapsed container — the `hidden`-when-collapsed block. */
function collapsedBlock(): string {
  // Anchored on the TEST ID, not on the className expression: adding the id split that line and
  // broke this locator, which is what the self-check below caught.
  const start = STACK.indexOf('data-testid="home-banner-collapsed"')
  expect(start, 'the collapsed container has been renamed — this test is now checking nothing')
    .toBeGreaterThan(-1)
  return STACK.slice(start)
}

describe('RV-119 — which banners collapse', () => {
  it('collapses exactly the four that were agreed, no more', () => {
    expect([...COLLAPSING_BANNERS]).toEqual(
      ['exerciseDetected', 'goalsCheckin', 'dayReview', 'weeklyRecap'])
  })

  it('keeps the illness advisory OUT of the strip — it is a today thing', () => {
    // It stays in the parent, above the stack, so it cannot be collapsed by editing the stack alone.
    expect(STACK.includes('<IllnessAdvisoryBanner'), 'the illness advisory moved into the stack')
      .toBe(false)
    expect(PARENT.includes('<IllnessAdvisoryBanner'), 'the illness advisory left the parent').toBe(true)
  })

  it('keeps the early-deload warning full-width, not inside the collapsed container', () => {
    expect(STACK.includes('<EarlyDeloadCard'), 'the early-deload card is not rendered at all').toBe(true)
    expect(collapsedBlock().includes('<EarlyDeloadCard'),
      'the early-deload warning was moved behind the strip — it is a today thing, by the owner\'s split')
      .toBe(false)
  })

  it('does put all four agreed banners inside the collapsed container', () => {
    const block = collapsedBlock()
    for (const tag of ['<ExerciseDetectedCard', '<GoalsCheckinCard', '<DismissibleBanner', '<WeeklyRecapBanner']) {
      expect(block.includes(tag), `${tag} is not behind the strip`).toBe(true)
    }
  })

  it('hides the four rather than unmounting them, which is what the strip counts', () => {
    // Unmounting would take them out of the presence registry AND throw away their state — the
    // second is why their own dismiss controls survive at all.
    const block = collapsedBlock()
    expect(block.includes('{expanded && ('), 'the four are conditionally rendered, so the strip cannot count them')
      .toBe(false)
  })
})

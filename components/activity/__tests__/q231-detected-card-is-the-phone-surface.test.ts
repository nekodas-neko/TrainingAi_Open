import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const CARD = read('components/activity/exercise-detected-card.tsx')
const SHEET = read('components/activity/exercise-review-sheet.tsx')
const STORE = read('lib/stores/auto-detection-store.ts')
const LAYOUT = read('app/layout.tsx')
const PROVIDER = read('components/walk-offer-provider.tsx')
const BANNER_STACK = read('components/home/home-banner-stack.tsx')

/**
 * Q-231 asked for this card to be retired outright, on the stated grounds that *"retiring this card
 * removes nothing he currently sees working"* — the owner's yes was conditional on exactly that.
 *
 * **The condition does not hold, and these tests are why.** `pendingSessions` has a second writer
 * that has nothing to do with the Oura Cloud sync: the phone-GPS detector, started unconditionally
 * from the root layout on native. This card is the only surface that renders one — the review sheet
 * resolves a session by an id only this card supplies — so removing it orphans that pipeline with
 * no compile error and no failing test anywhere else.
 *
 * What Q-231 legitimately removed is the Cloud plumbing: the unreviewed fetch, the ingest, and the
 * mark-reviewed PATCH. The card and the phone path stayed.
 *
 * **#3844 (owner, 16 Nov) then removed the phone-GPS detector.** The card stays because the walk
 * offer from the day's movement data writes `pendingSessions` too, and the root layout now starts
 * only that offer.
 */
describe('Q-231 — the detected card is the walk offer’s only surface', () => {
  it('the root layout starts the walk offer, and nothing starts a live detector (#3844)', () => {
    expect(LAYOUT).toContain('<WalkOfferProvider />')
    expect(PROVIDER).toContain('offerRingWalks()')
    expect(PROVIDER).not.toMatch(/startAutoDetection|auto-detection-service/)
  })

  it('the store\'s writer is the walk offer', () => {
    expect(STORE).toMatch(/offerRingWalks: \(walks\) =>/)
    expect(STORE).toMatch(/set\(\{ pendingSessions: \[\.\.\.pendingSessions, \.\.\.added\] \}\)/)
    expect(STORE).not.toMatch(/endSession|startSession|sessionPoints/)
  })

  it('⛔ the card renders pendingSessions — removing it orphans the walk offer', () => {
    expect(CARD).toContain('useAutoDetectionStore(s => s.pendingSessions)')
    expect(BANNER_STACK).toContain('<ExerciseDetectedCard')
  })

  it('the review sheet reaches a session only by an id the card hands it', () => {
    expect(SHEET).toContain('pendingSessions.find(p => p.id === sessionId)')
    expect(CARD).toContain('onReview(session.id)')
  })

  // Matched as CODE, not as a mention: both files explain in prose what was removed and why, and a
  // rule that fires on a comment inside the file it is checking is the false positive
  // `scripts/lib/strip-comments.js` exists for. It caught this on the first run.
  it('the Oura Cloud plumbing is gone from both surfaces', () => {
    for (const [name, src] of [['card', CARD], ['sheet', SHEET]] as const) {
      expect(src, `${name} must not call the retired Cloud route`)
        .not.toMatch(/fetch\(\s*['"`]\/api\/oura\/workouts/)
      expect(src, `${name} must not branch on the retired source`)
        .not.toMatch(/\bsource\s*(!==|===)\s*'oura'/)
      expect(src, `${name} must not read the Cloud row id`)
        .not.toMatch(/\.ouraWorkoutId\b|\bouraWorkoutId:/)
    }
  })

  it('a session persisted as Oura before the change is dropped on rehydrate, not rendered', () => {
    expect(STORE).toMatch(/state\.pendingSessions = state\.pendingSessions\.filter\(/)
    expect(STORE).toContain("!== 'oura'")
  })
})

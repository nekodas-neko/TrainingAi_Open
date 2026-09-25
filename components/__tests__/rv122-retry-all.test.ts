import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const code = (rel: string) =>
  readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

const CARD = 'components/more/sync-health-card.tsx'

/**
 * RV-122 — the sync-failure card could not clear itself in fewer than one tap per failure.
 *
 * The entry's own prescription was to promote the `/more/data` "Sync now" button onto the card.
 * These assertions encode why that would not have worked, so the next reader does not undo the
 * correction: that button calls `pullDelta`, which never pushes, and even a push leaves a
 * dead-lettered row dead until `retryFailedMutation` resets it.
 */
describe('RV-122 — the premise the fix rests on', () => {
  it('"Sync now" pulls and does not push, so it could never have cleared this card', () => {
    const panel = code('components/more/data-sync-panel.tsx')
    expect(panel).toMatch(/pullDelta\(/)
    expect(panel, 'if Sync now ever starts pushing, RV-122\'s original fix becomes viable again')
      .not.toMatch(/pushMutations/)
  })

  it('a push alone does not revive a dead-lettered row — the reset is a separate call', () => {
    const backend = code('lib/local-store/sqlite-backend.ts')
    // retryFailedMutation is what moves status back to 'pending'; without it a failed row is
    // skipped by the push entirely.
    expect(backend).toMatch(/async retryFailedMutation[\s\S]{0,400}?status = 'pending'/)
  })
})

describe('RV-122 — the card can clear itself in one tap', () => {
  it('batches the reset and pushes ONCE, not once per row', () => {
    const src = code(CARD)
    expect(src).toMatch(/const\s+handleRetryAll\s*=\s*useGuardedAction\(/)
    const body = src.slice(src.indexOf('handleRetryAll'))
    const upToDiscard = body.slice(0, body.indexOf('handleDiscard'))
    expect(upToDiscard).toMatch(/for\s*\([^)]*rows\)[\s\S]{0,120}retryFailedMutation/)
    expect(
      (upToDiscard.match(/pushMutations\(/g) ?? []).length,
      'one push for the batch — N retries sending N pushes is what this replaces',
    ).toBe(1)
  })

  it('is guarded, so it cannot double-fire against the per-item retry beside it', () => {
    expect(code(CARD)).toMatch(/useGuardedAction/)
  })

  it('disables every button on the card while the batch runs', () => {
    const src = code(CARD)
    // `busyId === m.id` would leave the sibling rows tappable mid-batch.
    expect(src, 'a per-row disable check leaves the other rows live during a batch retry')
      .not.toMatch(/disabled=\{busyId === m\.id\}/)
    expect((src.match(/disabled=\{busyId !== null\}/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('is not offered for a single failure, where it would duplicate the Retry above it', () => {
    expect(code(CARD)).toMatch(/failed\.length > 1 &&[\s\S]{0,400}Retry all/)
  })
})

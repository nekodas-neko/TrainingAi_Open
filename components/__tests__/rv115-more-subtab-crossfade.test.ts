import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * RV-115 — More's Profile ↔ Friends swap was a hard `display:none` toggle sharing one scroller.
 *
 * Two things had to be true for the crossfade to be an improvement rather than a trade, and both
 * are load-bearing enough to pin:
 *
 * **1. The panels must re-seed synchronously.** `TabPanels` is `AnimatePresence mode="wait"`, so
 * the outgoing panel UNMOUNTS. That is fine only because both views paint from a `readCacheSync`
 * seed; delete that seeding and this swap silently becomes a skeleton flash on every switch, which
 * CLAUDE.md calls a bug outright. Nothing in More would fail — the regression would show up as a
 * flicker nobody traces back here.
 *
 * **2. The scroll reset must skip its first run.** `useScrollRestoration` re-asserts a saved offset
 * for a whole window after mount, so a reset that fired on mount would fight it.
 */
describe('RV-115 — the More sub-tab swap crossfades and starts at the top', () => {
  it('swaps through TabPanels rather than a display toggle', () => {
    const s = src('app/more/more-content.tsx')
    expect(s, 'must use the existing crossfade primitive').toMatch(/<TabPanels value=\{tab\}>/)
    expect(s, 'the display toggle is what RV-115 removed')
      .not.toMatch(/style=\{\{\s*display:\s*tab ===/)
  })

  it('sends the shared scroller back to the top on a swap', () => {
    expect(src('app/more/more-content.tsx')).toMatch(/scrollResetKey=\{tab\}/)
  })

  it('the reset skips its first run, so it cannot race the scroll restoration', () => {
    // Both live on the same ref in the same component; a mount-time reset would land inside the
    // window useScrollRestoration re-asserts its target across.
    const s = src('components/pull-to-sync.tsx')
    expect(s).toMatch(/lastResetKey/)
    expect(s, 'must bail when the key has not actually changed')
      .toMatch(/if \(lastResetKey\.current === scrollResetKey\) return/)
  })

  it('both unmounted panels still paint from cache — the precondition for mode="wait"', () => {
    expect(src('components/more/profile-tab.tsx'), 'profile must seed synchronously')
      .toMatch(/readCacheSync/)
    expect(src('components/more/friends-tab.tsx'), 'friends must seed synchronously')
      .toMatch(/readCacheSync<\{ friendships/)
  })

  it('TabPanels still unmounts the outgoing panel, which is why the seeds above matter', () => {
    // If this ever becomes a keep-mounted crossfade, the seeding requirement relaxes — and this
    // test should be revisited rather than deleted.
    expect(src('components/ui/tab-panels.tsx')).toMatch(/mode="wait"/)
  })
})

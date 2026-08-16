import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Q-248: the owner photographed a "Readiness saved" toast sitting on top of the unchanged
 * "How are you feeling? / Log Readiness" prompt. The toast and the sheet close fire synchronously
 * on the tap; the callback that flips the card behind them did not — it sat after
 * `await localWrite`, and the comment directly above that write documents it stalling for ~2
 * minutes when a sync pull's `applyDelta` holds the one Capacitor SQLite connection.
 *
 * The fix is an `onOptimisticSave` firing on the same beat as the toast, carrying the optimistic
 * log. `onSaved` stays where it is, behind the write and the invalidation, because it triggers the
 * prescription refetch and starting that first reads the stale `workout-data` cache straight back
 * (the session-164 ordering rule). Getting either half of that wrong reintroduces one of two bugs.
 *
 * Read from source rather than rendered: this project's vitest runs `environment: 'node'` with no
 * JSX transform, so a .tsx component cannot be imported — same constraint and same approach as
 * `carousel-dot-hit-area.test.ts`.
 */

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const SHEET = 'components/mood-checkin-sheet.tsx'
const HOME = 'app/session-select/session-select-content.tsx'

/** Index of the first match, or -1. Throws on a pattern that should be unique but is not. */
function soleIndex(src: string, re: RegExp, what: string): number {
  const all = [...src.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))]
  if (all.length > 1) throw new Error(`${what}: expected one occurrence, found ${all.length}`)
  return all.length === 1 ? all[0].index! : -1
}

describe('readiness save flips the card without waiting on the local write (Q-248)', () => {
  const sheet = read(SHEET)

  it('fires the optimistic callback on the same beat as the toast', () => {
    const toast = soleIndex(sheet, /toast\.success\("Readiness saved"\)/, 'the saved toast')
    const close = soleIndex(sheet, /onOpenChange\(false\)/, 'the sheet close')
    const optimistic = soleIndex(sheet, /onOptimisticSave\?\.\(log\)/, 'the optimistic callback')
    expect(toast).toBeGreaterThan(-1)
    expect(optimistic).toBeGreaterThan(-1)
    // All three in the same synchronous run, before anything is awaited.
    expect(optimistic).toBeGreaterThan(toast)
    expect(optimistic).toBeGreaterThan(close)
  })

  it('does not put the optimistic callback behind an await', () => {
    const optimistic = sheet.indexOf('onOptimisticSave?.(log)')
    const asyncBlock = sheet.indexOf('const savedLocally = await localWrite')
    expect(asyncBlock).toBeGreaterThan(-1)
    // This is the whole bug: the flip must not live inside the deferred block the write gates.
    expect(optimistic).toBeLessThan(asyncBlock)
  })

  it('still runs onSaved after the invalidation, so the refetch cannot read a stale cache', () => {
    // The session-164 rule. Reordering these to "fix" Q-248 would trade one bug for another.
    const invalidate = sheet.indexOf('await invalidateCheckinAffectsPrescription()')
    const onSaved = sheet.indexOf('onSaved?.(log)')
    expect(invalidate).toBeGreaterThan(-1)
    expect(onSaved).toBeGreaterThan(invalidate)
  })

  it('Home wires the raw setter, which cannot carry the refetch that must stay ordered', () => {
    // Passing `setMoodLog` rather than a hand-written handler is the point: a handler could grow a
    // `fetchWorkoutData()` later and silently reintroduce the session-164 stale-cache read on the
    // callback that now runs first. The setter structurally cannot.
    expect(read(HOME)).toContain('onOptimisticSave={setMoodLog}')
  })
})

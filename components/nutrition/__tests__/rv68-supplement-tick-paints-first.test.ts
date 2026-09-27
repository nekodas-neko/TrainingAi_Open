import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** RV-68. The tick used to paint only after three awaited local writes and a native call, so on a
 *  contended store it appeared long after the tap.
 *
 *  This is not a guess about "the local write is fast". The repo measured the identical shape and
 *  wrote it down in `components/mood-checkin-sheet.tsx`: the Capacitor SQLite plugin has ONE
 *  connection, so a tap landing during the sync pull's applyDelta transaction queues behind the
 *  whole delta, and awaiting it left that button reading "Saving…" for about two minutes on
 *  2026-08-13. Supplements write to the same store from the Nutrition tab, where `pullDelta` lands.
 *
 *  The property that matters is an ORDERING, which no assertion about the rendered output could
 *  catch on a fast store — it only diverges under contention, which the sandbox cannot stage. So it
 *  is asserted on the source. */

const ROOT = path.resolve(__dirname, '../../..')
const SRC = readFileSync(path.join(ROOT, 'components/nutrition/supplements-section.tsx'), 'utf8')

/** `toggleLog`'s body, brace-balanced — a fixed window would be defeated by any comment. */
function toggleLogBody(): string {
  const at = SRC.indexOf('async function toggleLog(')
  expect(at, 'toggleLog is gone — this file would assert nothing').toBeGreaterThan(-1)
  const open = SRC.indexOf('{', SRC.indexOf(')', at))
  let d = 1, j = open + 1
  while (j < SRC.length && d > 0) { const c = SRC[j]; if (c === '{') d++; else if (c === '}') d--; j++ }
  return SRC.slice(open, j)
}

describe('RV-68 — the supplement tick paints before the writes, not after', () => {
  it('applyOptimistic() runs before the first await in the handler', () => {
    const body = toggleLogBody()
    const paint = body.indexOf('applyOptimistic()')
    const firstAwait = body.indexOf('await ')
    expect(paint, 'applyOptimistic is no longer called').toBeGreaterThan(-1)
    expect(firstAwait, 'no await left — the shape changed, re-read this test').toBeGreaterThan(-1)
    expect(paint, 'the tick must be on screen before anything is awaited').toBeLessThan(firstAwait)
  })

  it('a failed write undoes the tick, since it is already painted', () => {
    // The old code could stay silent in its catch precisely because it had not painted yet.
    const body = toggleLogBody()
    expect(body).toMatch(/catch\s*\{[^}]*revertOptimistic\(\)/)
  })

  it('the in-flight guard is released when the write settles, not with the paint', () => {
    // Releasing it with the paint would re-open the double-tap window that once turned five taps
    // into four complete-workout POSTs. The user gets the tick back immediately; not the tap.
    //
    // **Matched on the release rather than on one spelling of it (RV-207 ③).** This read
    // `indexOf('setToggling(null)')`, which broke the moment the guard became a per-id Set —
    // a legitimate refactor, and the property below was true throughout. A literal is the wrong
    // thing to pin when what matters is *where* the call sits.
    const body = toggleLogBody()
    const paint = body.indexOf('applyOptimistic()')
    const release = body.search(/setToggling\((?!prev => new Set\(prev\)\.add)/)
    expect(release, 'the guard is never released — the row would stay dead').toBeGreaterThan(-1)
    expect(release).toBeGreaterThan(paint)
    expect(body.slice(release - 200, release)).toMatch(/finally\s*\{/)
  })
})

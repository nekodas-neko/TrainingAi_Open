import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * No effect in `SyncProvider` may issue a network call without consulting `userId`.
 *
 * `SyncProvider` is mounted in the root layout, so every one of its mount effects runs on **every**
 * signed-out route too. Q-150 measured what that cost by loading `/sign-in` with no session: 12
 * requests to `/api/*`, all 401, one of them a `POST /api/oura/sync` — an expensive external-sync
 * route fired before login. The push and pull phases were guarded; the cache-warm phase and
 * `maybeSyncOura` were not. (`maybeSyncOura` no longer exists — the Oura Cloud sync was removed
 * 2026-08-13; the case below now pins its absence rather than its guard.)
 *
 * This is a source-text check rather than a behavioural one because the repo has **no jsdom
 * environment and no component tests** — vitest runs `environment: 'node'` for every project in
 * `vitest.config.ts`. Rendering this component to assert on its fetches would mean adding jsdom and
 * a testing library, which is a dependency decision and not this fix's to make. What the check can
 * do without any of that is hold the invariant that actually broke: an effect that reaches the
 * network must mention the thing that says whether there is a user.
 *
 * Adding a fetch to a new effect here means gating it, or this fails and names the effect.
 */

const SRC = readFileSync(join(process.cwd(), 'components/sync-provider.tsx'), 'utf8')

/** Anything in this file that reaches the network. `getCached`/`mirrorToSessionCache` do not. */
const NETWORK_MARKERS = ['fetch(', 'cachedFetch', 'pushMutations(', 'pullDelta(']

interface Effect {
  line: number
  /** The arrow-function body only — deps are held separately so a `[userId]` dep can't be
   *  mistaken for an in-body guard. Those are different things and only one of them stops a fetch. */
  body: string
  deps: string
}

/**
 * Every `useEffect(() => { … }, [deps])` in the file, brace-matched so nested blocks and the
 * dynamic-`import().then()` callbacks inside them stay with their own effect.
 */
function effects(): Effect[] {
  const out: Effect[] = []
  const open = 'useEffect(() => {'
  let from = 0
  for (;;) {
    const start = SRC.indexOf(open, from)
    if (start === -1) break
    let depth = 1
    let i = start + open.length
    while (i < SRC.length && depth > 0) {
      if (SRC[i] === '{') depth++
      else if (SRC[i] === '}') depth--
      i++
    }
    const close = SRC.indexOf(')', i)
    out.push({
      line: SRC.slice(0, start).split('\n').length,
      body: SRC.slice(start, i),
      deps: SRC.slice(i, close).replace(/^\s*,\s*/, '').trim(),
    })
    from = close
  }
  return out
}

describe('SyncProvider auth gating (Q-150)', () => {
  const all = effects()

  it('finds every effect in the file', () => {
    // Guards the parser itself: a rewrite that changes the `useEffect(() => {` spelling would
    // otherwise make this whole suite pass by finding nothing.
    expect(all.length).toBe(SRC.split('useEffect(').length - 1)
    expect(all.length).toBeGreaterThanOrEqual(8)
  })

  it('has no networked effect that ignores userId', () => {
    const networked = all.filter(e => NETWORK_MARKERS.some(m => e.body.includes(m)))
    expect(networked.length).toBeGreaterThan(0)

    const ungated = networked.filter(e => !e.body.includes('userId')).map(e => e.line)
    expect(ungated).toEqual([])
  })

  it('gates the cache-warm phase, which was the bulk of the 12 calls', () => {
    const warm = all.find(e => e.body.includes('WARM_CHUNK'))
    expect(warm).toBeDefined()
    // The guard must precede the warm loop, not merely appear somewhere in the effect: the push
    // and pull phases above it were already guarded while the warm phase below them was not.
    const guard = warm!.body.indexOf('if (!userId) return')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(warm!.body.indexOf('WARM_CHUNK'))
  })

  // Was: "gates the Oura cloud sync, which fired an unauthenticated POST". That effect was REMOVED
  // 2026-08-13 on the owner's decision ("get rid of oura cloud references we dont use it") — the
  // ring has been on our own BLE key since the 2026-07-07 re-key, so the call could only ever earn a
  // 401. The Q-150 guard it used to assert is moot once the call is gone; what is worth holding now
  // is that it stays gone, since re-adding it would reintroduce both the dead call and the
  // signed-out POST. The general invariant above still covers a re-added effect that forgets its
  // guard; this names the specific one.
  it('no longer reaches the Oura Cloud at all', () => {
    expect(SRC).not.toContain('/api/oura/sync')
    expect(SRC).not.toContain('maybeSyncOura')
    expect(all.some(e => e.body.includes('/api/oura/'))).toBe(false)
  })

  it('leaves the two BLE radio effects ungated, deliberately', () => {
    // These own hardware, not fetches. A failed post from the step orchestrator re-queues in its
    // own localStorage retry buffer and the server dedups on `(user_id, start_ds)`, so a signed-out
    // window is recovered rather than lost — and stopping/restarting the ring radio on an auth
    // transition is a device behaviour change that cannot be verified in this sandbox.
    const ungated = all.filter(e => e.deps === '[]')
    expect(ungated.length).toBe(2)
    expect(ungated.every(e => NETWORK_MARKERS.every(m => !e.body.includes(m)))).toBe(true)
  })
})

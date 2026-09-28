import { describe, it, expect } from 'vitest'
import { prescribeRequestInit } from '../prescribe-request'

/**
 * LA-177 — the post-completion `/prescribe` call must exclude the session that just finished.
 *
 * Called rather than pattern-matched. The first version of this guard read `workout-screen.tsx` as
 * text, and a control run showed one of its assertions was satisfied by a *different* fetch in that
 * file — there are four `Content-Type: application/json` headers in it. Extracting the helper made the
 * behaviour callable, which is both a stronger test and the answer `check-component-size` wanted
 * anyway.
 */

const WS_ID = 'ws-1f2e3d4c'

describe('prescribeRequestInit', () => {
  it('sends the completed session as excludeSessionId', () => {
    const init = prescribeRequestInit(WS_ID)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ excludeSessionId: WS_ID })
  })

  it('declares JSON, or the route parses {} and silently drops the field', () => {
    // `readJsonLimited` falls back to `{}` for an unreadable body and the schema then accepts it, so a
    // missing content type is not an error anywhere — it just loses the exclusion. That is the same
    // silent-success shape as the original bug, which is why it is asserted rather than assumed.
    expect(prescribeRequestInit(WS_ID).headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('omits the field entirely when there is no session id', () => {
    // `''`, not null: `workoutSessionId` is a string initialised to empty. Sending `''` would pass the
    // route's `z.string().optional()` and exclude nothing (`signals.ts` compares `s.id !== ''`), while
    // still collapsing the dedup key onto the open-path one.
    const init = prescribeRequestInit('')
    expect(init).toEqual({ method: 'POST' })
    expect(init.body, 'an empty id must send no body at all').toBeUndefined()
    expect(init.headers).toBeUndefined()
  })

  it('never sends an empty-string exclusion, whatever the falsy input', () => {
    for (const empty of ['', undefined as unknown as string, null as unknown as string]) {
      expect(prescribeRequestInit(empty)).toEqual({ method: 'POST' })
    }
  })
})

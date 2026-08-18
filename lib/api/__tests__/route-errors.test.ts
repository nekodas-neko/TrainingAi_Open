import { describe, it, expect } from 'vitest'
import { NotFoundError, isNotFoundError } from '@trainingai/shared/errors'
import { routeErrorResponse } from '@/lib/api/route-errors'

// Q-463. Five write routes answered 500 for "the row you named does not exist", four of them with an
// empty body. One cause: sixteen bare `throw new Error('… not found')` in the repository and nothing
// mapping them, so Next's default handler answered.
//
// Three consequences, each against a rule this repo already wrote: the sync client retries what can
// never succeed (4xx is a poison pill, 5xx is "back off and retry"); an empty body makes the
// client's `res.json()` throw on top of the failure; and it fills `error_events` — the only view of
// faults nobody watches — with stack traces from correctly-refused requests.

describe('NotFoundError', () => {
  it('reads as "<Resource> not found", matching what the correct routes already say', () => {
    expect(new NotFoundError('Supplement').message).toBe('Supplement not found')
    expect(new NotFoundError().message).toBe('Not found')
    expect(new NotFoundError('Injury').resource).toBe('Injury')
  })

  // The reason the marker exists: the Next server bundle and the rollup worker's separate esbuild
  // output can each hold their own copy of the class, and `instanceof` silently returns false across
  // them. A structural copy stands in for that here.
  it('is recognised without instanceof, across a bundle boundary', () => {
    const original = new NotFoundError('Meal type')
    expect(isNotFoundError(original)).toBe(true)

    const structuralCopy = { ...original, message: original.message, name: original.name }
    expect(structuralCopy instanceof NotFoundError).toBe(false)
    expect(isNotFoundError(structuralCopy)).toBe(true)
  })

  it('does not claim an ordinary Error', () => {
    for (const other of [new Error('Supplement not found'), new TypeError('x'), null, undefined, 'not found', {}]) {
      expect(isNotFoundError(other)).toBe(false)
    }
  })
})

describe('routeErrorResponse', () => {
  it('maps to 404 with a JSON body — four of the five returned an EMPTY body', async () => {
    const res = routeErrorResponse(new NotFoundError('Phase set'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Phase set not found' })
  })

  // The mapper must not become a blanket 4xx: a genuine bug still has to reach onRequestError and
  // error_events. Clearing the correctly-refused requests out of that table is the point; swallowing
  // real failures would make it worse at the same job.
  it('re-throws anything it does not recognise, unchanged', () => {
    const bug = new TypeError('cannot read properties of undefined')
    expect(() => routeErrorResponse(bug)).toThrow(bug)
    // A bare Error with the same words is NOT a NotFoundError — the type is the contract, not the
    // message. This is what stops the mapper degenerating into substring matching, which is exactly
    // how phase-sets' DELETE ended up answering 500.
    const looksSimilar = new Error('Supplement not found')
    expect(() => routeErrorResponse(looksSimilar)).toThrow(looksSimilar)
  })
})

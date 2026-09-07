/**
 * LA-70 — twenty routes answered `{ error: parsed.error.issues[0]?.message }`, which put zod's own
 * phrasing on screen: live, a user saw *"Too big: expected string to have <=80 characters"*.
 *
 * What makes this worth a helper rather than a find-and-replace is that dropping the message
 * wholesale is also wrong — a message someone wrote FOR the user is the one worth showing. These
 * pin the line between the two, and in particular the case the obvious fix gets wrong.
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { invalidBodyResponse, userFacingIssueMessage } from '../route-errors'

const failure = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value)
  if (r.success) throw new Error('fixture parsed successfully — it must fail')
  return r.error
}

const messageOf = async (schema: z.ZodType, value: unknown) => {
  const res = invalidBodyResponse(failure(schema, value))
  expect(res.status).toBe(400)
  return (await res.json()).error as string
}

describe('zod wording never reaches the user', () => {
  it('replaces the library phrasing for a length check', async () => {
    // The exact string LA-70 quoted from production.
    expect(await messageOf(z.object({ n: z.string().max(80) }), { n: 'y'.repeat(90) }))
      .toBe('Invalid body')
  })

  it('replaces it for a regex, an enum and a range', async () => {
    expect(await messageOf(z.object({ d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), { d: 'x' })).toBe('Invalid body')
    expect(await messageOf(z.object({ n: z.enum(['a', 'b']) }), { n: 'c' })).toBe('Invalid body')
    expect(await messageOf(z.object({ n: z.number().min(1) }), { n: 0 })).toBe('Invalid body')
  })

  it('never leaks the shape of the request — a wrong type or an unknown key', async () => {
    // Both describe the WIRE FORMAT rather than a value the user chose, so neither is ever shown
    // even though `invalid_type`'s message cannot be compared against the default map (the issue
    // reaching a caller has lost its `input`, so the map re-renders it as "received undefined").
    expect(await messageOf(z.object({ n: z.number() }), { n: 'abc' })).toBe('Invalid body')
    expect(await messageOf(z.object({ a: z.string() }).strict(), { a: 'x', b: 1 })).toBe('Invalid body')
  })

  it('uses the caller\'s fallback when it passes one', async () => {
    const res = invalidBodyResponse(failure(z.object({ n: z.string() }), {}), 'Invalid goal')
    expect((await res.json()).error).toBe('Invalid goal')
  })
})

describe('a message written for the user survives', () => {
  it('keeps a .refine message', async () => {
    const schema = z.object({ n: z.string() }).refine(o => o.n === 'q', { message: 'Pick at least one day' })
    expect(await messageOf(schema, { n: 'z' })).toBe('Pick at least one day')
  })

  it('keeps a message on a BUILT-IN check — the case `code === custom` gets wrong', async () => {
    // This is the whole reason the helper compares wording instead of codes. In zod 4.4.3
    // `z.string().min(1, 'Name is required')` reports `code: 'too_small'`, not 'custom', so the
    // obvious filter would silently discard a message someone wrote for the user.
    const schema = z.object({ n: z.string().min(1, 'Name is required') })
    expect(failure(schema, { n: '' }).issues[0].code).toBe('too_small')
    expect(await messageOf(schema, { n: '' })).toBe('Name is required')
  })

  it('prefers a written message over an earlier library one', async () => {
    const schema = z.object({ a: z.string().max(2), b: z.string().min(1, 'Give it a name') })
    expect(await messageOf(schema, { a: 'toolong', b: '' })).toBe('Give it a name')
  })

  it('returns null from the string form when nothing was written', () => {
    expect(userFacingIssueMessage(failure(z.object({ n: z.string().max(2) }), { n: 'abc' }))).toBeNull()
    expect(userFacingIssueMessage(failure(z.object({ n: z.string().min(1, 'Needed') }), { n: '' }))).toBe('Needed')
  })
})

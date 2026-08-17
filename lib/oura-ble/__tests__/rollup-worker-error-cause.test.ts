import { describe, it, expect } from 'vitest'
import { msg } from '@/lib/oura-ble/rollup-worker-entry'

// A redecode failed three times on 2026-08-17 and every report said the same thing: the SQL text and
// the params, with no reason. Drizzle's DrizzleQueryError puts the SQL in `.message` and the driver
// error in `.cause`, and the worker flattened errors with `err.message` alone — so a statement
// timeout, a dead connection and a permissions error were all indistinguishable across the thread
// boundary. These assert the part that was missing: the cause, and pg's `code`.
describe('rollup worker error flattening', () => {
  const drizzleShaped = (cause: unknown) =>
    Object.assign(new Error('Failed query: select "id" from "oura_ble_clock_anchors"'), { cause })

  it('carries the underlying reason, not just the query text', () => {
    const pgErr = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
    const out = msg(drizzleShaped(pgErr))
    expect(out).toContain('Failed query')
    expect(out).toContain('canceling statement due to statement timeout')
    expect(out).toContain('57014')
  })

  it('distinguishes failures that used to look identical', () => {
    const timeout = msg(drizzleShaped(Object.assign(new Error('canceling statement'), { code: '57014' })))
    const dead = msg(drizzleShaped(new Error('Connection terminated unexpectedly')))
    const denied = msg(drizzleShaped(Object.assign(new Error('permission denied'), { code: '42501' })))
    expect(new Set([timeout, dead, denied]).size).toBe(3)
  })

  it('follows a nested chain and terminates on a cycle', () => {
    const inner = new Error('root cause')
    const mid = Object.assign(new Error('middle'), { cause: inner })
    expect(msg(drizzleShaped(mid))).toContain('root cause')

    const a = new Error('a') as Error & { cause?: unknown }
    const b = Object.assign(new Error('b'), { cause: a })
    a.cause = b
    expect(() => msg(a)).not.toThrow()
    expect(msg(a)).toBe('a\n  caused by: b')
  })

  it('still handles a plain error and a non-Error throw', () => {
    expect(msg(new Error('plain'))).toBe('plain')
    expect(msg('just a string')).toBe('just a string')
  })
})

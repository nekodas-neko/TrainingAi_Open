// #2381 — no credential reaches `agent_action_log.parameters`, at any depth.
import { describe, it, expect } from 'vitest'
import { redactActionParameters } from '../redact'

describe('redactActionParameters (#2381)', () => {
  it('drops every key that names a credential, whatever its case', () => {
    const out = redactActionParameters({
      date: '2026-09-15',
      table: 'oura_raw_samples',
      dryRun: true,
      AGENT_ACTIONS_SECRET: 's1',
      token: 't1',
      accessToken: 't2',
      apiKey: 'k1',
      key: 'k2',
      password: 'p1',
      newPasswd: 'p2',
      Authorization: 'Bearer x',
      authorisation: 'Bearer y',
      cookie: 'c',
      credentials: { u: 'x' },
      bearer: 'b',
      webhookSignature: 'sig',
    })
    expect(out).toEqual({ date: '2026-09-15', table: 'oura_raw_samples', dryRun: true })
  })

  it('walks nested objects and arrays', () => {
    const out = redactActionParameters({
      window: { from: '2026-09-01', to: '2026-09-30', session_token: 'x' },
      steps: [{ name: 'rollup', secretHex: 'y' }, 'plain', 3],
    })
    expect(out).toEqual({
      window: { from: '2026-09-01', to: '2026-09-30' },
      steps: [{ name: 'rollup' }, 'plain', 3],
    })
  })

  it('never mutates its input', () => {
    const input = { a: 1, token: 'x', nested: { password: 'y', b: 2 } }
    const copy = structuredClone(input)
    redactActionParameters(input)
    expect(input).toEqual(copy)
  })

  it('gives an empty object for nothing, and drops what JSON cannot hold', () => {
    expect(redactActionParameters(undefined)).toEqual({})
    expect(redactActionParameters(null)).toEqual({})
    expect(redactActionParameters({ a: undefined, f: () => 1, n: BigInt(10), ok: null })).toEqual({ n: '10', ok: null })
  })

  it('stops walking a pathologically deep object instead of recursing without end', () => {
    let deep: Record<string, unknown> = { leaf: true }
    for (let i = 0; i < 50; i++) deep = { d: deep }
    const json = JSON.stringify(redactActionParameters(deep))
    expect(json).not.toContain('leaf')
  })
})

// The renewal pass's cross-replica lock (#2895 review). It was transaction-scoped, so it held a
// transaction open across up to 22 Oura calls; the pool's 15 s `idle_in_transaction_session_timeout`
// killed it mid-pass, which dropped the lock and raised an `error` on a client nobody listened to.
//
// The unit half checks the shape against a fake client; the database half (skipped without a local
// Postgres) checks the lock really excludes a second pass and is really released.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { renewalPass, runOuraWebhookRenewal, type RenewalDeps } from '../renewal'
import { resetOuraCloudReportThrottle } from '../report'

const reportServerError = vi.fn()
/** `report.ts` loads `@/lib/observability` lazily, so a report lands a few ticks after the call. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
import type { SubscriptionReport } from '../subscriptions'

const REPORT: SubscriptionReport = { dryRun: false, current: [], renewed: [], created: [], failed: [] }

const ENV = {
  OURA_CLIENT_ID: 'cid',
  OURA_CLIENT_SECRET: 'csecret',
  OURA_REDIRECT_URI: 'https://trainingai.example/api/oura/callback',
  OURA_WEBHOOK_CALLBACK_URL: 'https://trainingai.example/api/oura/webhook',
  OURA_WEBHOOK_VERIFICATION_TOKEN: 'vt-123',
}

function fakeClient(lockGranted = true) {
  const client = Object.assign(new EventEmitter(), {
    queries: [] as string[],
    released: [] as (Error | undefined)[],
    query: vi.fn(async (text: string) => {
      client.queries.push(text)
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: lockGranted }] }
      return { rows: [] }
    }),
    release: vi.fn((err?: Error) => { client.released.push(err) }),
  })
  return client
}

function depsFor(client: ReturnType<typeof fakeClient>, ensure: RenewalDeps['ensure']): RenewalDeps {
  return { pool: { connect: async () => client } as unknown as RenewalDeps['pool'], ensure }
}

describe('Oura webhook renewal lock', () => {
  beforeEach(() => { for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v) })
  afterEach(() => vi.unstubAllEnvs())

  it('takes a session-level lock with no transaction, and unlocks and releases after the pass', async () => {
    const client = fakeClient()
    let listenersDuringPass = 0
    const ensure = vi.fn(async () => { listenersDuringPass = client.listenerCount('error'); return REPORT })
    await expect(runOuraWebhookRenewal(false, depsFor(client, ensure))).resolves.toBe(REPORT)
    expect(client.queries.some(q => /BEGIN|COMMIT|xact/i.test(q))).toBe(false)
    expect(client.queries[0]).toMatch(/pg_try_advisory_lock\(/)
    expect(client.queries.at(-1)).toMatch(/pg_advisory_unlock\(/)
    expect(listenersDuringPass).toBe(1)
    expect(client.listenerCount('error')).toBe(0)
    expect(client.released).toEqual([undefined])
  })

  it('unlocks even when the pass throws', async () => {
    const client = fakeClient()
    const ensure = vi.fn(async () => { throw new Error('boom') })
    await expect(runOuraWebhookRenewal(false, depsFor(client, ensure))).rejects.toThrow('boom')
    expect(client.queries.at(-1)).toMatch(/pg_advisory_unlock\(/)
    expect(client.released).toHaveLength(1)
  })

  it('does nothing and unlocks nothing when another replica holds the lock', async () => {
    const client = fakeClient(false)
    const ensure = vi.fn(async () => REPORT)
    await expect(runOuraWebhookRenewal(false, depsFor(client, ensure))).resolves.toBeNull()
    expect(ensure).not.toHaveBeenCalled()
    expect(client.queries.some(q => q.includes('pg_advisory_unlock'))).toBe(false)
    expect(client.released).toEqual([undefined])
  })

  it('a connection error while held is caught, and the client is destroyed rather than pooled', async () => {
    const client = fakeClient()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dropped = new Error('terminating connection due to administrator command')
    const ensure = vi.fn(async () => {
      // Without a listener, EventEmitter throws an unlistened 'error' straight out of emit().
      expect(() => client.emit('error', dropped)).not.toThrow()
      return REPORT
    })
    await runOuraWebhookRenewal(false, depsFor(client, ensure))
    expect(client.released).toEqual([dropped])
    expect(client.queries.some(q => q.includes('pg_advisory_unlock'))).toBe(false)
    consoleError.mockRestore()
  })
})

describe('Oura webhook renewal reporting (#2895 review)', () => {
  beforeEach(() => {
    reportServerError.mockReset()
    resetOuraCloudReportThrottle()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('records failed subscriptions, at most once an hour', async () => {
    const failed: SubscriptionReport = { ...REPORT, failed: [{ subscription: 'sleep:update', status: 500, error: 'create failed' }] }
    await renewalPass(async () => failed)
    await renewalPass(async () => failed)
    await vi.waitFor(() => expect(reportServerError).toHaveBeenCalled())
    await settle()
    expect(reportServerError).toHaveBeenCalledOnce()
    expect((reportServerError.mock.calls[0][0] as Error).message).toMatch(/webhook-renewal:failed: 1 subscription\(s\) failed: sleep:update \(500\)/)
  })

  it('records a pass that threw, and does not throw itself', async () => {
    await expect(renewalPass(async () => { throw new Error('db down') })).resolves.toBeUndefined()
    await vi.waitFor(() => expect(reportServerError).toHaveBeenCalled())
    expect((reportServerError.mock.calls[0][0] as Error).message).toMatch(/webhook-renewal:error: db down/)
  })

  it('records nothing for a clean pass or a pass another replica ran', async () => {
    await renewalPass(async () => REPORT)
    await renewalPass(async () => null)
    await settle()
    expect(reportServerError).not.toHaveBeenCalled()
  })
})

const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('Oura webhook renewal lock against Postgres', () => {
  beforeEach(() => { for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v) })
  afterEach(() => vi.unstubAllEnvs())

  it('excludes a second pass while one runs, and is free again afterwards', async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const pool = getPool()
    let secondResult: SubscriptionReport | null | undefined
    const ensureSecond = vi.fn(async () => REPORT)
    const ensureFirst = vi.fn(async () => {
      secondResult = await runOuraWebhookRenewal(false, { pool, ensure: ensureSecond })
      return REPORT
    })
    await expect(runOuraWebhookRenewal(false, { pool, ensure: ensureFirst })).resolves.toBe(REPORT)
    expect(secondResult).toBeNull()
    expect(ensureSecond).not.toHaveBeenCalled()
    // Released: the next pass gets it.
    await expect(runOuraWebhookRenewal(false, { pool, ensure: ensureSecond })).resolves.toBe(REPORT)
  })
})

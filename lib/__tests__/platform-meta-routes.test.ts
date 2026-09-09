/**
 * PS-39 — how the app reports and delivers itself: `version`, `status`, `download-apk` and `export`.
 *
 * Batched because they are the four routes that answer *what is running, is it alive, how do I get
 * the newest build, and give me my data back* — the surface an owner reaches for when something is
 * wrong, which is the worst possible time for one of them to be subtly untrue. What each decides:
 *
 *   · **`version` and `nativeVersion` are DIFFERENT things**, and conflating them is a shipped bug
 *     this route exists to fix. The APK loads its UI from Railway, so nearly every release reaches
 *     the device with no reinstall; comparing against the web `version` told the owner to reinstall
 *     for changes they already had, every release, which is a banner you learn to ignore.
 *   · **`null` means "could not check", never "up to date"** — hence `nativeVersionStatus`, because
 *     a bare null was undiagnosable in production.
 *   · **`version` is the ONE sanctioned `Cache-Control: public` route in the app.** Every other
 *     `/api` route is `private, no-store` and a script enforces it. Pinned here so the exemption is
 *     a tested decision rather than an entry on an allowlist nobody re-reads.
 *   · **`status` must never leak connection details.** It is unauthenticated by design — an uptime
 *     monitor calls it — so the catch branch answering with a driver's error message would publish
 *     the database host to anyone who asks.
 *   · **`status` rate-limits on the client IP taken from the RIGHT of `x-forwarded-for`** (Q-493).
 *     The leftmost entry is whatever the caller sent, so keying on it lets the caller choose its own
 *     bucket and the gate does nothing.
 *   · **`download-apk` separates "could not check" (502) from "no APK in the release" (404)**, the
 *     same distinction `version` draws with its status field.
 *
 * Fixture discipline (the PS-39 note): where two quantities could coincide — the two versions, the
 * forgeable and real IPs, the user's zone and the default — the fixture forces them apart, because
 * equal values put nothing under test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

const lookupLatestApkRelease = vi.fn(async () => ({ release: null, status: 'ok' }) as unknown)
const fetchLatestApkRelease = vi.fn(async () => null as unknown)
const query = vi.fn(async (..._a: unknown[]) => ({ rows: [] }))
const getPool = vi.fn(() => ({ query }))
const rateLimit = vi.fn((..._a: unknown[]) => true)
const exportUserData = vi.fn()

// The real changelog changes on every release, so a fixture built from it would assert a moving
// target — and, worse, its top version would coincide with whatever the release lookup returns only
// by accident. Two fixed, DIFFERENT versions instead.
const WEB_VERSION = '9.9.9'
const NATIVE_VERSION = '8.8.8'

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/github-release', () => ({
  lookupLatestApkRelease: () => lookupLatestApkRelease(),
  fetchLatestApkRelease: () => fetchLatestApkRelease(),
}))
vi.mock('@/lib/data/postgres/client', () => ({ getPool: () => getPool() }))
vi.mock('@/lib/export/full-export', () => ({ exportUserData: (...a: unknown[]) => exportUserData(...a) }))
vi.mock('@trainingai/shared/changelog', () => ({
  CHANGELOG: [{ version: '9.9.9', date: '2026-09-08', changes: ['x'] }],
}))

import { GET as getVersion } from '@/app/api/version/route'
import { GET as getStatus } from '@/app/api/status/route'
import { GET as getApk } from '@/app/api/download-apk/route'
import { GET as getExport } from '@/app/api/export/route'

const APK_URL = 'https://github.example/releases/download/v8.8.8/app.apk'
const statusReq = (forwardedFor?: string) =>
  getStatus(new NextRequest('http://localhost/api/status', {
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  }))

beforeEach(() => {
  for (const m of [lookupLatestApkRelease, fetchLatestApkRelease, query, getPool, rateLimit, exportUserData]) m.mockClear()
  rateLimit.mockReturnValue(true)
  query.mockResolvedValue({ rows: [] })
  getPool.mockReturnValue({ query })
  lookupLatestApkRelease.mockResolvedValue({ release: null, status: 'unconfigured' })
  fetchLatestApkRelease.mockResolvedValue(null)
  exportUserData.mockImplementation(async function* () { yield { _manifest: { excluded: [] } } })
  sessionUser = { id: 'u-1' }
})
afterEach(() => { vi.useRealTimers() })

describe('GET /api/version', () => {
  it('reports the web release and the APK release as separate numbers', async () => {
    // Deliberately different. Equal versions would let the route read either source for either
    // field and still answer correctly — the trap this whole route exists because of.
    expect(WEB_VERSION).not.toBe(NATIVE_VERSION)
    lookupLatestApkRelease.mockResolvedValue({
      release: { version: NATIVE_VERSION, sha: 'abc1234', publishedAt: '2026-09-01T00:00:00Z', apkUrl: APK_URL },
      status: 'ok',
    })
    const body = await (await getVersion()).json()
    expect(body).toMatchObject({
      version: WEB_VERSION,
      nativeVersion: NATIVE_VERSION,
      nativeVersionStatus: 'ok',
      nativeBuildSha: 'abc1234',
      nativeBuiltAt: '2026-09-01T00:00:00Z',
    })
  })

  it('says WHY there is no native version rather than answering a bare null', async () => {
    // A null on its own reads as "up to date" to anyone debugging, which is the opposite of what it
    // means. The status is what makes an unconfigured integration distinguishable from a failed
    // lookup — undiagnosable in production before it existed.
    for (const status of ['unconfigured', 'unavailable']) {
      lookupLatestApkRelease.mockResolvedValue({ release: null, status })
      const body = await (await getVersion()).json()
      expect(body.nativeVersion).toBeNull()
      expect(body.nativeVersionStatus).toBe(status)
      expect(body.version).toBe(WEB_VERSION)
    }
  })

  it('is the one route allowed a public cache header, and uses it', async () => {
    // `scripts/check-api-no-store.js` fails the build on a cache header in any `app/api` route and
    // exempts exactly this one by name. The exemption is only correct if the route actually relies
    // on it — otherwise it is an allowlist entry protecting nothing.
    const res = await getVersion()
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300')
  })

  it('answers without a session, because the update card runs before login', async () => {
    sessionUser = null
    const res = await getVersion()
    expect(res.status).toBe(200)
    expect((await res.json()).version).toBe(WEB_VERSION)
  })
})

describe('GET /api/status', () => {
  it('reports the database up when the ping answers', async () => {
    const res = await statusReq('3.3.3.3')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, db: 'up', version: WEB_VERSION })
    expect(query).toHaveBeenCalledWith('SELECT 1')
  })

  it('answers 503 and leaks nothing when the ping throws', async () => {
    // The message carries a host and password, as a driver's error genuinely does. This route is
    // unauthenticated by design — an uptime monitor calls it — so anything echoed here is published.
    query.mockRejectedValue(new Error('connect ECONNREFUSED db.internal:5432 password=hunter2'))
    const res = await statusReq('3.3.3.3')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, db: 'down', version: WEB_VERSION })

    const raw = JSON.stringify(await (await statusReq('3.3.3.3')).json())
    for (const secret of ['db.internal', 'hunter2', 'ECONNREFUSED', '5432']) {
      expect(raw, secret).not.toContain(secret)
    }
  })

  it('gives up on a hanging database rather than hanging with it', async () => {
    // A monitor that never gets an answer reads as a timeout on the whole app, not on the database
    // — the race is what turns an unbounded wait into a diagnosis.
    vi.useFakeTimers()
    query.mockReturnValue(new Promise(() => {}))
    const pending = statusReq('3.3.3.3')
    await vi.advanceTimersByTimeAsync(3_000)
    const res = await pending
    expect(res.status).toBe(503)
    expect((await res.json()).db).toBe('down')
  })

  it('keys the rate limit on the hop nearest US, not the one the caller chose (Q-493)', async () => {
    // A proxy APPENDS the peer it saw, so the leftmost entry is caller-supplied. Keying on it lets
    // a caller rotate its own bucket and the gate does nothing — measured at 30 keys of count 1
    // against a limit of 20. The two addresses differ so the assertion can tell which was used.
    await statusReq('1.1.1.1, 2.2.2.2, 3.3.3.3')
    const key = String(rateLimit.mock.calls[0][0])
    expect(key).toContain('3.3.3.3')
    expect(key).not.toContain('1.1.1.1')
  })

  it('refuses over the rate limit without touching the database', async () => {
    rateLimit.mockReturnValue(false)
    const res = await statusReq('3.3.3.3')
    expect(res.status).toBe(429)
    expect(getPool).not.toHaveBeenCalled()
  })
})

describe('GET /api/download-apk', () => {
  it('redirects to the published APK', async () => {
    fetchLatestApkRelease.mockResolvedValue({ version: NATIVE_VERSION, sha: 'a', publishedAt: null, apkUrl: APK_URL })
    const res = await getApk()
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(APK_URL)
  })

  it('separates "could not check" from "checked, and there is no APK"', async () => {
    // Same distinction `/api/version` draws with its status field: one is a broken integration to
    // fix, the other is a release that genuinely has no artifact. One code for both hides the first.
    fetchLatestApkRelease.mockResolvedValue(null)
    expect((await getApk()).status).toBe(502)

    fetchLatestApkRelease.mockResolvedValue({ version: NATIVE_VERSION, sha: 'a', publishedAt: null, apkUrl: null })
    expect((await getApk()).status).toBe(404)
  })

  it('refuses without a session, before reaching for the release', async () => {
    sessionUser = null
    expect((await getApk()).status).toBe(401)
    expect(fetchLatestApkRelease).not.toHaveBeenCalled()
  })
})

describe('GET /api/export', () => {
  const readAll = async (res: Response) => await res.text()

  it('streams NDJSON for the caller, one JSON line per record', async () => {
    exportUserData.mockImplementation(async function* () {
      yield { _manifest: { excluded: ['sessions'] } }
      yield { domain: 'body_metrics', row: { id: 1 } }
    })
    const res = await getExport()
    expect(exportUserData).toHaveBeenCalledWith('u-1')
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson')

    const lines = (await readAll(res)).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toEqual({ _manifest: { excluded: ['sessions'] } })
    expect(JSON.parse(lines[1])).toEqual({ domain: 'body_metrics', row: { id: 1 } })
  })

  it("names the file with the USER's date, not the server's", async () => {
    // 20:00 UTC on the 10th is still the 10th in UTC−5 and already the 11th in Brisbane. A fixture
    // whose timezone IS `DEFAULT_TZ` could not tell the two apart, and the filename is the only
    // thing the user ever sees of this decision.
    expect(DEFAULT_TZ).toBe('Australia/Brisbane')
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-10T20:00:00Z'))

    sessionUser = { id: 'u-1', timezone: 'Etc/GMT+5' }
    expect((await getExport()).headers.get('Content-Disposition'))
      .toBe('attachment; filename="trainingai-export-2026-03-10.ndjson"')

    sessionUser = { id: 'u-1' }
    expect((await getExport()).headers.get('Content-Disposition'))
      .toBe('attachment; filename="trainingai-export-2026-03-11.ndjson"')
  })

  it('closes the stream on a mid-export failure — the file is TRUNCATED, not marked failed', async () => {
    // Pinning what the route does today, not endorsing it. The headers are already sent by the time
    // the generator throws, so the status cannot change; the route logs and closes, and the user
    // gets a short file that looks complete. Recorded as LA-84 rather than fixed here, because the
    // remedy is a terminal error line and that changes the file's contract for any consumer.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    exportUserData.mockImplementation(async function* () {
      yield { domain: 'body_metrics', row: { id: 1 } }
      throw new Error('pagination blew up halfway')
    })
    const res = await getExport()
    expect(res.status).toBe(200)

    const lines = (await readAll(res)).trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({ domain: 'body_metrics', row: { id: 1 } })
    // Nothing in the payload says it is incomplete — which is the finding.
    expect(await readAll(new Response(lines.join('\n')))).not.toContain('error')
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('refuses without a session, and over a rate limit that is two per HOUR', async () => {
    sessionUser = null
    expect((await getExport()).status).toBe(401)
    expect(rateLimit).not.toHaveBeenCalled()

    sessionUser = { id: 'u-1' }
    rateLimit.mockReturnValue(false)
    expect((await getExport()).status).toBe(429)
    expect(exportUserData).not.toHaveBeenCalled()
    // A full takeout reads every table; the window is an hour, not a minute, and a copied
    // 60_000 from a sibling route would be a 60× loosening that no status code reveals.
    expect(rateLimit).toHaveBeenCalledWith('export:u-1', 2, 60 * 60 * 1000)
  })
})

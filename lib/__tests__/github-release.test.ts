import { describe, it, expect, vi } from 'vitest'
import { lookupLatestApkRelease, mapApkRelease, parseNativeReleaseSha, parseNativeReleaseVersion } from '@/lib/github-release'

// The exact strings `.github/workflows/android.yml` publishes today.
const NAME = 'Latest debug APK (v1.255.1)'
const BODY =
  'Auto-built from `main` @ 8ff51fa (v1.255.1). Debug build for sideloading on the S25 — download `app-debug.apk` below.'

describe('parseNativeReleaseVersion', () => {
  it('reads the version the workflow writes into the release title', () => {
    expect(parseNativeReleaseVersion(NAME, BODY)).toBe('1.255.1')
  })

  it('falls back to the notes when the title has no version', () => {
    expect(parseNativeReleaseVersion('Latest debug APK', BODY)).toBe('1.255.1')
  })

  it('returns null rather than guessing when neither carries one', () => {
    // An unknown native version must leave the update card silent. Anything other than null
    // here would make it assert something it does not know.
    expect(parseNativeReleaseVersion('Latest debug APK', 'no version here')).toBeNull()
    expect(parseNativeReleaseVersion(null, null)).toBeNull()
    expect(parseNativeReleaseVersion(undefined, undefined)).toBeNull()
  })

  it('does not mistake a bare or partial version for a tagged one', () => {
    expect(parseNativeReleaseVersion('v1.255.1', 'built from 1.255')).toBeNull()
  })
})

describe('parseNativeReleaseSha', () => {
  it('reads the short commit from the notes', () => {
    expect(parseNativeReleaseSha(BODY)).toBe('8ff51fa')
  })

  it('returns null when the notes carry no commit', () => {
    expect(parseNativeReleaseSha('Debug build for sideloading.')).toBeNull()
    expect(parseNativeReleaseSha(null)).toBeNull()
  })
})

describe('mapApkRelease', () => {
  // The real `apk-latest` payload, captured from the GitHub API on 2026-08-04.
  const REAL = {
    name: NAME,
    body: BODY,
    published_at: '2026-08-04T09:20:07Z',
    assets: [
      { name: 'app-debug.apk', browser_download_url: 'https://github.com/nekodas-neko/TrainingAi_Open/releases/download/apk-latest/app-debug.apk' },
    ],
  }

  it('maps the live release payload to the four fields the callers use', () => {
    expect(mapApkRelease(REAL)).toEqual({
      version: '1.255.1',
      sha: '8ff51fa',
      publishedAt: '2026-08-04T09:20:07Z',
      apkUrl: 'https://github.com/nekodas-neko/TrainingAi_Open/releases/download/apk-latest/app-debug.apk',
    })
  })

  it('nulls the APK url when the release carries no apk asset, rather than redirecting somewhere wrong', () => {
    expect(mapApkRelease({ ...REAL, assets: [{ name: 'notes.txt', browser_download_url: 'https://x/notes.txt' }] }).apkUrl).toBeNull()
    expect(mapApkRelease({ ...REAL, assets: undefined }).apkUrl).toBeNull()
  })
})

describe('lookupLatestApkRelease', () => {
  // Inverted when the repository went public (Q-49). It used to assert the opposite — that a missing
  // token short-circuits to `unconfigured` without spending a request — which was right while an
  // unauthenticated call to a private repo could only 404. Now the anonymous call is the normal
  // path, and short-circuiting would leave the update card permanently dead for exactly the
  // configuration production runs in.
  it('still asks GitHub when no token is set, because the repository is public', async () => {
    const prev = process.env.GITHUB_RELEASES_TOKEN
    delete process.env.GITHUB_RELEASES_TOKEN
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ name: 'Latest debug APK (v9.9.9)', assets: [] }), { status: 200 }),
    )
    try {
      const { status } = await lookupLatestApkRelease()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(status).not.toBe('unconfigured')
      // No Authorization header when there is no token — sending `Bearer undefined` would turn a
      // working anonymous request into a 401.
      const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
      expect(headers).not.toHaveProperty('Authorization')
    } finally {
      fetchSpy.mockRestore()
      if (prev !== undefined) process.env.GITHUB_RELEASES_TOKEN = prev
    }
  })

  // Q-457. The two payload fixtures above carry a repo URL but prove nothing about which repo is
  // *asked*, so the default could be flipped back to the archived private repo without a single test
  // failing — which is exactly how it survived the migration. This asserts the URL instead.
  it('defaults to the public repo when APK_RELEASE_REPO is unset', async () => {
    const prev = process.env.APK_RELEASE_REPO
    // The module reads the variable once, at import — so this asserts the default that was baked in
    // when the suite loaded, which is the configuration a fresh environment gets.
    expect(prev, 'APK_RELEASE_REPO must be unset for this test to say anything').toBeUndefined()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ name: 'Latest debug APK (v9.9.9)', assets: [] }), { status: 200 }),
    )
    try {
      await lookupLatestApkRelease()
      const url = String(fetchSpy.mock.calls[0][0])
      expect(url).toContain('/repos/nekodas-neko/TrainingAi_Open/')
      // The archived, private, pre-cut repo. Reading it returns a release whose APK never changes
      // again, and surfaces as "Could not fetch release info" rather than as a misconfiguration.
      expect(url).not.toContain('/repos/nekodas-neko/TrainingAI/')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('sends the token when one is set, for the higher rate limit', async () => {
    const prev = process.env.GITHUB_RELEASES_TOKEN
    process.env.GITHUB_RELEASES_TOKEN = 'test-token'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ name: 'Latest debug APK (v9.9.9)', assets: [] }), { status: 200 }),
    )
    try {
      await lookupLatestApkRelease()
      const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer test-token')
    } finally {
      fetchSpy.mockRestore()
      if (prev === undefined) delete process.env.GITHUB_RELEASES_TOKEN
      else process.env.GITHUB_RELEASES_TOKEN = prev
    }
  })
})

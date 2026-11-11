// The rolling `apk-latest` GitHub release — the one artifact that says what the newest
// *native* build actually is.
//
// Why this rather than `package.json`: the APK is a WebView loading Railway, so almost every
// release reaches the phone with no reinstall. Comparing the installed APK against the server's
// current version therefore reports "update available" for changes the device already has, which
// is what made the More → Update card permanently on and therefore ignorable. The release is only
// republished when a native path changes, so the version *it* carries is the honest comparison
// target.

/**
 * Which repository publishes the APK. Env-driven so the public-repo cut (Q-49 Phase B4) is a
 * Railway variable rather than a code change — and, more usefully, so getting it wrong is
 * recoverable without a deploy.
 *
 * The failure it prevents is quiet: after the cut, a hardcoded pointer keeps resolving against the
 * *archived* repo, whose `apk-latest` release still exists and still returns 200. The update card
 * would go on reporting a version that never changes again, with nothing in the logs to say so.
 *
 * The default is this repository, so an unset variable degrades to "correct" rather than to a
 * silent dead end (Q-457). It used to default to the pre-cut `nekodas-neko/TrainingAI`, which is
 * archived and private: with the variable unset or missed on a new environment, the app read
 * releases from a repo whose APK never changes again, and the failure surfaced as
 * "Could not fetch release info" rather than as a misconfiguration. A public clone got the same
 * dead end out of the box, against a repo it cannot read at all.
 *
 * Still a fallback rather than a required variable: throwing here would take down the More screen
 * over a stale env var, which is worse than a stale version number.
 */
const APK_RELEASE_REPO = process.env.APK_RELEASE_REPO ?? 'nekodas-neko/TrainingAi_Open'
const RELEASE_URL = `https://api.github.com/repos/${APK_RELEASE_REPO}/releases/tags/apk-latest`

/**
 * Why a lookup produced no version. A bare null was undiagnosable in production — it could mean
 * GitHub is down or the release was mid-recreate — and the owner cannot act on "null".
 *
 * `unconfigured` is retained but is now unreachable from this module: it existed for a missing
 * `GITHUB_RELEASES_TOKEN` back when the releases lived in a private repository, where an
 * unauthenticated call could only 404. The repository is public, so no token is needed. The member
 * stays in the union because `/api/version` publishes this value and a client pinned to the old
 * shape should not meet an unknown string; drop it once nothing reads it.
 */
export type ApkReleaseStatus = 'ok' | 'unconfigured' | 'unavailable'

export interface ApkRelease {
  /** Marketing version of the build that produced the current APK, or null if unparseable. */
  version: string | null
  /** Commit the APK was built from, short form. Diagnostic only. */
  sha: string | null
  /** When the current APK was built. BF-111: the APK ASSET's `updated_at`, not the release's
   *  `published_at` — see `mapApkRelease`. */
  publishedAt: string | null
  apkUrl: string | null
}

/**
 * The workflow writes the version into both the release title and its notes, in the same
 * `(vX.Y.Z)` form, and recreates the release on every publish — so neither string can drift from
 * the artifact or be edited out of band. Returns null rather than guessing: an unknown native
 * version must leave the update card silent, never assert.
 */
export function parseNativeReleaseVersion(name?: string | null, body?: string | null): string | null {
  for (const text of [name, body]) {
    const hit = text?.match(/\(v(\d+\.\d+\.\d+)\)/)
    if (hit) return hit[1]
  }
  return null
}

/** Short commit SHA from the release notes (`Auto-built from \`main\` @ abc1234`). */
export function parseNativeReleaseSha(body?: string | null): string | null {
  return body?.match(/@ ([0-9a-f]{7,40})\b/)?.[1] ?? null
}

interface RawRelease {
  name?: string | null
  body?: string | null
  published_at?: string | null
  assets?: { name: string; browser_download_url: string; updated_at?: string | null }[]
}

/** Release JSON -> the four things we use. Split out so it can be tested without the network. */
export function mapApkRelease(release: RawRelease): ApkRelease {
  const apk = release.assets?.find(a => a.name.endsWith('.apk'))
  return {
    version: parseNativeReleaseVersion(release.name, release.body),
    sha: parseNativeReleaseSha(release.body),
    // BF-111. The rolling release is created once and its asset re-uploaded on every publish, so
    // `published_at` never moves: measured 2026-09-28, the release reads 2026-08-23 while its APK was
    // uploaded 2026-09-25. Every build since the first printed "built 23 Aug". The asset's
    // `updated_at` is the build's own date; the release date is only a fallback with no asset.
    publishedAt: apk?.updated_at ?? release.published_at ?? null,
    apkUrl: apk?.browser_download_url ?? null,
  }
}

/**
 * Fetches the rolling release. Returns null on any failure — a caller must treat "could not
 * check" as its own state, not as up-to-date and not as an update being available.
 */
export async function fetchLatestApkRelease(): Promise<ApkRelease | null> {
  return (await lookupLatestApkRelease()).release
}

/**
 * As `fetchLatestApkRelease`, but says *why* it failed. A lookup can land while the workflow is
 * replacing the APK asset and briefly see none, which is a transient condition the owner should not
 * go looking for a cause behind. (This said the release is "deleted and recreated on every publish";
 * measured 2026-09-28 it is not. It was created on 2026-08-23 and only its asset is replaced, which
 * is BF-111.)
 */
export async function lookupLatestApkRelease(): Promise<{ release: ApkRelease | null; status: ApkReleaseStatus }> {
  // No token needed since the repository went public (Q-49). It used to be required — an
  // unauthenticated call to a private repo can only 404 — and its absence was reported as
  // `unconfigured` rather than spending a request to rediscover that. The variable had in fact been
  // unset in Railway since 2026-08-04, so this card had been dead the whole time; going public is
  // what revives it, and dropping the requirement is what makes that true in code.
  //
  // Still sent when present, because an authenticated call gets 5,000 requests/hour against 60 for
  // an anonymous one, per IP. Neither limit is close for this app, so treat the token as an
  // optimisation and never as a dependency.
  const token = process.env.GITHUB_RELEASES_TOKEN
  // Bounded: this sits behind a user-facing card, and `fetch` has no default timeout, so a
  // stalled GitHub call would otherwise hang the More screen rather than fall back.
  const res = await fetch(RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(5_000),
    next: { revalidate: 300 },
  }).catch(() => null)

  if (!res?.ok) return { release: null, status: 'unavailable' }
  const release = await res.json().catch(() => null)
  if (!release) return { release: null, status: 'unavailable' }
  return { release: mapApkRelease(release), status: 'ok' }
}

// ── The native app's release build (#3723) ────────────────────────────────────────────────────
//
// After the switch-over (#2849) the phone runs the native app (`mobile/`), whose screens ship
// inside the APK, so a new build reaches the phone only by download. `native-release.yml` attaches
// the signed release APK to the rolling `native-release-latest` release, and only when dispatched
// with both `publish` and `confirm_switch_done` set. Until it has published once, the release does
// not exist and this lookup reports null, which the native About screen treats as "say nothing".
//
// A separate release from `apk-latest`, on purpose: that one is the Capacitor app's, and
// `fetchLatestApkRelease` above offers its first `.apk` to the installed Capacitor app.

const NATIVE_RELEASE_TAG = 'native-release-latest'
const NATIVE_RELEASE_URL = `https://api.github.com/repos/${APK_RELEASE_REPO}/releases/tags/${NATIVE_RELEASE_TAG}`

export interface NativeReleaseBuild {
  /** The app's marketing version, from `(vX.Y.Z)` in the release title or notes. */
  versionName: string
  /** The Android versionCode, from `version code N` in the notes. The number About compares. */
  versionCode: number
  /** When the APK was uploaded (the asset's `updated_at`, as BF-111 for `apk-latest`). */
  publishedAt: string | null
  /** The release page, where the APK is downloaded. */
  pageUrl: string
}

/** `version code 1234` in the notes the workflow writes. Null rather than a guess. */
export function parseNativeReleaseVersionCode(name?: string | null, body?: string | null): number | null {
  for (const text of [name, body]) {
    const hit = text?.match(/\bversion code (\d{1,10})\b/)
    if (!hit) continue
    const code = Number(hit[1])
    // Android stores it as a signed 32-bit integer; native-release.yml caps it at 2100000000.
    if (Number.isSafeInteger(code) && code > 0 && code <= 2_100_000_000) return code
  }
  return null
}

interface RawNativeRelease extends RawRelease {
  html_url?: string | null
}

/**
 * Release JSON -> the build About compares against. Null unless the release carries an APK, a
 * version name and a version code: a half-written release must leave the notice silent.
 */
export function mapNativeReleaseBuild(release: RawNativeRelease): NativeReleaseBuild | null {
  const apk = release.assets?.find(a => a.name.endsWith('.apk'))
  const versionName = parseNativeReleaseVersion(release.name, release.body)
  const versionCode = parseNativeReleaseVersionCode(release.name, release.body)
  if (!apk || !versionName || versionCode === null) return null
  const expectedPage = `https://github.com/${APK_RELEASE_REPO}/releases/tag/${NATIVE_RELEASE_TAG}`
  return {
    versionName,
    versionCode,
    publishedAt: apk.updated_at ?? release.published_at ?? null,
    // The page, not the APK's own URL: the notes there say what the build is before it installs.
    pageUrl: release.html_url === expectedPage ? release.html_url : expectedPage,
  }
}

/**
 * The newest published native release build, or null on any failure or before the first publish.
 * Same request, timeout and five-minute revalidation as `lookupLatestApkRelease`.
 */
export async function fetchNativeReleaseBuild(): Promise<NativeReleaseBuild | null> {
  const token = process.env.GITHUB_RELEASES_TOKEN
  const res = await fetch(NATIVE_RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(5_000),
    next: { revalidate: 300 },
  }).catch(() => null)

  if (!res?.ok) return null
  const release = await res.json().catch(() => null)
  return release ? mapNativeReleaseBuild(release) : null
}

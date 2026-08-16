// Compares two x.y.z version strings. Returns true when `current` is behind
// `latest` (i.e. an update is available) — never true for equal or ahead
// (a locally-built dev APK can be numerically ahead of the last CHANGELOG entry).
export function isUpdateAvailable(current: string, latest: string): boolean {
  const c = current.split('.').map(Number)
  const l = latest.split('.').map(Number)
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0
    const lv = l[i] ?? 0
    if (lv > cv) return true
    if (lv < cv) return false
  }
  return false
}

/**
 * What the More → app-build row should say.
 *
 * `unknown` is a real state, not a fallback to silence: the newest APK's version comes from a
 * network lookup that can fail, and "could not check" must never be rendered as "up to date".
 * A false all-clear is the same class of mistake as the false alarm this replaced.
 *
 * Compare against the newest published **APK**'s version, never the server's current version —
 * the APK loads the UI from Railway, so nearly every release reaches the device without a
 * reinstall, and comparing against the server version left this permanently claiming an update.
 */
export type UpdateState = 'update' | 'current' | 'unknown'

export function resolveUpdateState(
  installed: string | null | undefined,
  newestApk: string | null | undefined,
): UpdateState {
  if (!installed || !newestApk) return 'unknown'
  return isUpdateAvailable(installed, newestApk) ? 'update' : 'current'
}

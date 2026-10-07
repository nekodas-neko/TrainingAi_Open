import { readFileSync } from "fs"
import { join } from "path"

// The release a Sentry event is tagged with, so a fault can be tied to the deploy that shipped it
// (RV-179 / Q-252's one surviving ask; session replay was decided against and is not here).
//
// Two halves, joined: the `package.json` version a release bumps once per Tuesday, and the build SHA
// that says WHICH build of it. The version alone cannot tell a hotfix from the release it patched,
// and the SHA alone cannot be read by a human. Sentry's own convention for this is
// `package@version+build`, which also keeps the semver part sortable.
//
// **Why it is explicit and not left to the SDK.** `withSentryConfig` auto-detects a release from the
// environment or from git `HEAD`. The release workflow ships with `railway up`, an upload with no
// git history and no `RAILWAY_GIT_COMMIT_SHA` (see `lib/build-sha.ts`), so on the deploy path that
// matters the SDK finds nothing and events carry no release at all.
//
// Built from `NEXT_PUBLIC_APP_VERSION` and `NEXT_PUBLIC_BUILD_ID`, which `next.config.ts` bakes in
// at build time, because that is the one value the browser bundle, the server and the edge runtime
// can all read and all agree on. The browser's value is the build the DEVICE is running, which is
// the point: a stale shell reports the release it is, not the one that is live now.
const PACKAGE = "trainingai"

export function sentryRelease(
  version: string | undefined,
  buildId: string | undefined,
): string | undefined {
  const v = version?.trim()
  if (!v) return undefined
  const b = buildId?.trim()
  return b ? `${PACKAGE}@${v}+${b}` : `${PACKAGE}@${v}`
}

/** `package.json`'s version, or null when it cannot be read. Build-time only (`next.config.ts`). */
export function readAppVersion(root: string = process.cwd()): string | null {
  try {
    const v = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown }).version
    return typeof v === "string" && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

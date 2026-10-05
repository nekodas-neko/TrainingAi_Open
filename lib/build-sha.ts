import { readFileSync } from "fs"
import { join } from "path"

// The commit this deploy was built from, or null when nothing says.
//
// Two sources, because there are two ways a build reaches Railway. A deploy Railway pulls from
// GitHub gets `RAILWAY_GIT_COMMIT_SHA`. A deploy the release workflow pushes with `railway up`
// does NOT — it is an upload, not a git checkout — so the workflow writes the commit into
// `BUILD_SHA` at the root of what it uploads. Without the file, every release read as `null`:
// the deploy check could never see its own deploy land, and the service-worker cache name fell
// back to a per-process timestamp (found on the first release, 2026-10-05).
export const BUILD_SHA_FILE = "BUILD_SHA"

export function readBuildSha(
  env: { RAILWAY_GIT_COMMIT_SHA?: string } = process.env,
  root: string = process.cwd(),
): string | null {
  const fromEnv = env.RAILWAY_GIT_COMMIT_SHA?.trim()
  if (fromEnv) return fromEnv
  try {
    const fromFile = readFileSync(join(root, BUILD_SHA_FILE), "utf8").trim()
    return /^[0-9a-f]{7,40}$/.test(fromFile) ? fromFile : null
  } catch {
    return null
  }
}

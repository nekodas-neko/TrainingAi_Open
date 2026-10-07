import { readFileSync } from "fs"
import { join } from "path"

// `package.json`'s version, which is the half of the Sentry release a human reads. Build time only:
// `next.config.ts` calls it and bakes the result into `NEXT_PUBLIC_APP_VERSION`. It imports `fs`,
// so it must never be imported by anything that runs in the edge runtime — `./sentry-release` is
// the runtime-safe half, kept separate for exactly that reason.
/** The version, or null when `package.json` cannot be read or has none. */
export function readAppVersion(root: string = process.cwd()): string | null {
  try {
    const v = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown }).version
    return typeof v === "string" && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

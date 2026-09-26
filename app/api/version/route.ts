import { NextResponse } from "next/server"
import { CHANGELOG } from "@trainingai/shared/changelog"
import { lookupLatestApkRelease } from "@/lib/github-release"

// GET — public, cacheable version endpoint.
//
// `version` is the app's current release, shown in More and used by the changelog.
// `nativeVersion` is the version of the newest published **APK**, which is a different thing and
// the one the update card must compare against: the APK loads the UI from Railway, so nearly every
// release reaches the device with no reinstall. Comparing against `version` told the owner to
// reinstall for changes they already had, every release, which is a banner you learn to ignore.
//
// null means "could not check" — never "up to date". The card keeps quiet on null rather than
// asserting either way.
export async function GET() {
  const version = CHANGELOG[0]?.version ?? "unknown"
  const { release, status } = await lookupLatestApkRelease()
  return NextResponse.json(
    {
      version,
      nativeVersion: release?.version ?? null,
      // Why there is no native version, when there isn't one. A bare null was undiagnosable in
      // production. Not auth-gated: the response is `Cache-Control: public`, and varying its body
      // by session is a cache-poisoning footgun for the sake of hiding whether an optional
      // integration is configured — which is not a secret.
      nativeVersionStatus: status,
      nativeBuildSha: release?.sha ?? null,
      nativeBuiltAt: release?.publishedAt ?? null,
      // OR-168. The commit this WEB deploy was built from — the only field here that identifies a
      // deploy. `version` moves only when a PR bumps the changelog, which most merges do not, and
      // `nativeBuildSha` above is the APK's sha, a different artefact entirely. Railway sets this
      // at runtime; `app/sw.js/route.ts` already keys the service-worker cache on it.
      //
      // Read it with a cache-busting param: this response is `public, max-age=300` (deliberately,
      // and the one written exemption in `check-api-no-store.js`), so an unbusted poll can answer
      // from five minutes ago and report a deploy that has not happened.
      webBuildSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  )
}

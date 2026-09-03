import NextAuth from "next-auth"
import { authConfig } from "./auth.config"
import { NextResponse } from "next/server"

const { auth } = NextAuth(authConfig)

// /mobile-signin must be public or first-run APK sign-in cannot work: the Capacitor app
// opens it in a Chrome Custom Tab that holds no session, so the gate 307'd it to /sign-in
// and dropped the ?challenge= param — leaving the PKCE flow with no binding and the
// trainingai:// deep link never firing. Note "/mobile-signin".startsWith("/sign-in") is
// false, so the existing entry never covered it. It grants no authority /sign-in doesn't
// already grant: the page's only action is signIn("google").
const PUBLIC_PATHS = ["/sign-in", "/mobile-signin", "/pending", "/register", "/offline"]

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))

  if (!req.auth && !isPublic) {
    return NextResponse.redirect(new URL("/sign-in", req.url))
  }

  // Deactivated users are bounced to /pending regardless of valid JWT
  if (req.auth && req.auth.isActive === false && !isPublic) {
    return NextResponse.redirect(new URL("/pending", req.url))
  }

  if (req.auth && pathname === "/sign-in") {
    return NextResponse.redirect(new URL("/", req.url))
  }
})

export const config = {
  // `monitoring` is BF-92's Sentry tunnel (`tunnelRoute` in next.config.ts) and MUST be excluded, or
  // the gate 307s it to /sign-in and the browser's error report is dropped — the same silent drop,
  // moved from the CSP to here. Excluded rather than added to PUBLIC_PATHS because there is no page
  // to gate: the SDK installs it as a Next *rewrite* to `*.ingest.sentry.io`, so no handler of ours
  // ever runs and nothing of ours is reachable through it.
  //
  // ⚠ It is therefore reachable unauthenticated, which is the point and is also the cost: the
  // errors most worth having are the ones from the sign-in path, where by definition there is no
  // session, and where this app's own comment above records how fragile first-run APK sign-in is —
  // `/api/client-error` requires auth and has never captured any of them. What it opens is a relay
  // that can forward an envelope to some other Sentry project via this domain. No data of ours, no
  // auth surface, no database.
  matcher: ["/((?!api|monitoring|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon|apple-icon).*)"],
}

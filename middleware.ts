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

  // LA-58. `/api` used to be excluded from the matcher entirely, so the deactivation gate below ran
  // on pages and nothing else — a deactivated or still-pending user kept full API access to their
  // own data for as long as their cookie was valid. The browser bounced them to /pending; `curl`
  // with their cookie did not, and neither would a native client talking to the API directly.
  //
  // Only the deactivation gate applies here, and only as a 403. Everything else about `/api` stays
  // the routes' own business: each one authenticates and answers 401 itself, and redirecting an API
  // caller hands it an HTML sign-in page with a 307, which no client parses as an auth failure. A
  // request with no session therefore falls straight through — which is also what keeps
  // signature-authenticated ingest and webhook routes working, since they never carry one.
  //
  // `/api/auth/*` is excluded in the matcher below rather than here: those routes are how a session
  // comes to exist at all (NextAuth's handler, the mobile PKCE exchange, registration), so gating
  // them on having one is circular.
  if (pathname.startsWith("/api")) {
    if (req.auth && req.auth.isActive === false) {
      return NextResponse.json({ error: "Account is not active" }, { status: 403 })
    }
    return
  }

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
  // BF-92. `monitoring` is the Sentry tunnel (`tunnelRoute` in next.config.ts) and is deliberately
  // LEFT INSIDE this matcher — i.e. behind the auth gate. A signed-in request falls straight through
  // (no redirect), so the tunnel works for every session, which is the whole of what BF-92 reported:
  // Sentry heard nothing from the browser for 13 days while the owner was signed in.
  //
  // Excluding it was written, measured and then reverted, and the reasoning is worth keeping. What
  // exclusion buys is errors from the sign-in path, which has no session by definition and which
  // `/api/client-error` (auth-gated) has therefore never captured — the first-run APK flow this
  // file's own comment above records as fragile. What it costs is that the path becomes an
  // unauthenticated relay: the SDK installs it as a Next *rewrite*, so `?o=<org>&p=<project>` are
  // caller-supplied and anyone could forward an envelope to some other Sentry project via this
  // domain.
  //
  // That is bandwidth and reputation, not data — and notably NOT extra exposure of our own project,
  // whose DSN already ships in every client bundle by design. It was still judged not worth a new
  // unauthenticated surface for a bonus, when the reported defect is fixed without it.
  //
  // ⚠ To revisit, the evidence to look for is a sign-in failure nobody can diagnose. Adding
  // `monitoring|` to the negative lookahead below is the whole change; the service-worker branch and
  // the tunnel config need nothing.
  //
  // LA-58: `api` was the first exclusion here, which is why the deactivation gate never ran on any
  // of the 219 route files. It is now `api/auth` only — those three routes (NextAuth's handler, the
  // mobile PKCE exchange, registration) are how a session is created, so gating them on having one
  // would lock out sign-in itself. Every other `/api` path now reaches the handler above, which
  // touches only the deactivated case.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon|apple-icon).*)"],
}

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
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon|apple-icon).*)"],
}

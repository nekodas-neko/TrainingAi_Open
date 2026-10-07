import NextAuth from "next-auth"
import { authConfig } from "./auth.config"
import { NextResponse } from "next/server"

const { auth } = NextAuth(authConfig)
const PUBLIC_PATHS = ["/sign-in", "/mobile-signin", "/auth-mobile-bridge", "/pending", "/register", "/offline"]

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))
  if (pathname.startsWith("/api")) {
    if (req.auth && req.auth.isActive === false) {
      return NextResponse.json({ error: "Account is not active" }, { status: 403 })
    }
    return
  }

  if (!req.auth && !isPublic) {
    return NextResponse.redirect(new URL("/sign-in", req.url))
  }
  if (req.auth && req.auth.isActive === false && !isPublic) {
    return NextResponse.redirect(new URL("/pending", req.url))
  }

})

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon|apple-icon).*)"],
}

import NextAuth from "next-auth"
import { authConfig } from "./auth.config"
import { NextResponse } from "next/server"
import { sessionTokenFrom } from "@/lib/auth/session-token"
import { DATA_EPOCH_HEADER, DATA_EPOCH_STALE_HEADER, staleDataEpoch } from "@/lib/auth/data-epoch-gate"

const { auth } = NextAuth(authConfig)
const PUBLIC_PATHS = ["/sign-in", "/mobile-signin", "/auth-mobile-bridge", "/pending", "/register", "/offline"]

export default auth(async (req) => {
  const { pathname } = req.nextUrl
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))
  if (pathname.startsWith("/api")) {
    if (req.auth && req.auth.isActive === false) {
      return NextResponse.json({ error: "Account is not active" }, { status: 403 })
    }
    // #3369: a write from a device that has not wiped for an admin reset is refused, so old rows it
    // still holds cannot come back. Only writes are decoded here; reads pass untouched.
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const token = await sessionTokenFrom(req.headers).catch(() => null)
      const epoch = staleDataEpoch({
        method: req.method,
        pathname,
        userId: typeof token?.userId === "string" ? token.userId : undefined,
        accountEpoch: token?.dataEpoch,
        header: req.headers.get(DATA_EPOCH_HEADER),
        cookieHeader: req.headers.get("cookie"),
      })
      if (epoch !== null) {
        return NextResponse.json(
          { error: "data-epoch-stale", epoch, userId: token?.userId },
          { status: 409, headers: { "Cache-Control": "private, no-store", [DATA_EPOCH_STALE_HEADER]: "1" } },
        )
      }
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

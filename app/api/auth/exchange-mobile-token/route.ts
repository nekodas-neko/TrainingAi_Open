import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { consumeMobileAuthToken } from "@/lib/mobile-auth-tokens";
import { verifyPkce } from "@/lib/pkce";
import { rateLimit } from "@/lib/rate-limit";
import { readJsonLimited } from "@trainingai/shared/http/request-guards";
import { clientIp } from '@trainingai/shared/http/client-ip'

// A one-time token and a PKCE verifier — both short fixed-length strings. 8 KB is generous.
const MAX_EXCHANGE_BODY_BYTES = 8 * 1024;

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (!rateLimit(`mobile-token:${ip}`, 10, 5 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_EXCHANGE_BODY_BYTES);
  if (!read.ok) {
    return read.reason === "too_large"
      ? NextResponse.json({ error: "Request too large" }, { status: 413 })
      : NextResponse.json({ error: "Missing token or verifier" }, { status: 400 });
  }
  const body = read.body as { token?: unknown; verifier?: unknown; responseType?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : undefined;
  const verifier = typeof body?.verifier === "string" ? body.verifier : undefined;
  if (!token || !verifier) return NextResponse.json({ error: "Missing token or verifier" }, { status: 400 });

  if (body?.responseType !== undefined && body.responseType !== 'cookie' && body.responseType !== 'token') {
    return NextResponse.json({ error: "Invalid response type" }, { status: 400 });
  }

  // The token is consumed even when the verifier fails — deliberate; a
  // captured token burns on first (attacker) attempt rather than staying
  // redeemable for a later retry.
  const entry = consumeMobileAuthToken(token);
  if (!entry || !verifyPkce(verifier, entry.challenge)) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
  const sessionCookieValue = entry.sessionCookieValue;

  // Railway always serves HTTPS externally — use NODE_ENV rather than the
  // request URL, which may arrive over HTTP on the internal network.
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieName = isProduction
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

  if (body?.responseType === 'token') {
    const session = await getToken({
      req: { headers: new Headers({ authorization: `Bearer ${sessionCookieValue}` }) },
      secret: process.env.AUTH_SECRET,
      secureCookie: isProduction,
    });
    if (!session?.userId || typeof session.exp !== 'number' || session.exp <= Math.floor(Date.now() / 1000)) {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
    }
    return NextResponse.json({
      ok: true,
      accessToken: sessionCookieValue,
      tokenType: 'Bearer',
      expiresAt: session.exp,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName, sessionCookieValue, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}

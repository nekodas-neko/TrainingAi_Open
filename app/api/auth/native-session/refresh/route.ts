import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { readJsonLimited } from '@trainingai/shared/http/request-guards';
import { clientIp } from '@trainingai/shared/http/client-ip';
import { REFRESH_TOKEN_RE } from '@/lib/auth/refresh-token-hash';
import { rotateNativeSession } from '@/lib/auth/mobile/session';

// #2076. The native app swaps its refresh token for a new one-day access token and a successor
// refresh token. Unauthenticated by design: the refresh token is the credential. Every refusal is
// the same 401, so a caller cannot tell unknown from revoked from reused; a reused token also
// revokes its family (`rotateNativeSession`). Tokens never reach a log: the body is not echoed and
// a failure is reported without it.

const MAX_BODY_BYTES = 4 * 1024;
const Body = z.object({ refreshToken: z.string().regex(REFRESH_TOKEN_RE) }).strict();

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest) {
  if (!rateLimit(`native-session-refresh:${clientIp(req)}`, 20, 5 * 60 * 1000)) {
    return json({ error: 'Too many requests' }, 429);
  }
  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? json({ error: 'Request too large' }, 413)
      : json({ error: 'Invalid request' }, 400);
  }
  const parsed = Body.safeParse(read.body);
  if (!parsed.success) return json({ error: 'Invalid request' }, 400);
  try {
    const result = await rotateNativeSession(parsed.data.refreshToken);
    if (!result.ok) return json({ error: 'invalid_refresh_token' }, 401);
    return json(result.body);
  } catch {
    // Fail closed without the error object: a driver error can quote the statement's parameters.
    console.error('[native-session/refresh] refresh failed');
    return json({ error: 'Session refresh is temporarily unavailable' }, 503);
  }
}

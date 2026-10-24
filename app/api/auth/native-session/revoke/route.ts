import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { getRepositoryAsync } from '@/lib/data';
import { sessionTokenFrom } from '@/lib/auth/session-token';
import { hashRefreshToken, REFRESH_TOKEN_RE } from '@/lib/auth/refresh-token-hash';
import { rateLimit } from '@/lib/rate-limit';
import { readJsonLimited } from '@trainingai/shared/http/request-guards';
import { clientIp } from '@trainingai/shared/http/client-ip';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const Body = z.object({ refreshToken: z.string().regex(REFRESH_TOKEN_RE) }).strict();

// Sign-out revokes the device's whole family. The app signs out with its refresh token in the body,
// because a one-day access token (#2076) has often lapsed by then; holding the refresh token is the
// authority to end its own family. Without one, the bearer token names the family as before.
export async function POST(req: NextRequest) {
  if (req.headers.get('content-type')?.includes('application/json')) {
    if (!rateLimit(`native-session-revoke-ip:${clientIp(req)}`, 20, 60000))
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    const read = await readJsonLimited(req, 4 * 1024);
    const parsed = read.ok ? Body.safeParse(read.body) : null;
    if (!parsed?.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const repo = await getRepositoryAsync();
    const stored = await repo.findNativeRefreshTokenByHash(hashRefreshToken(parsed.data.refreshToken)!);
    if (stored) await repo.revokeNativeRefreshTokenFamily(stored.userId, stored.familyId, 'sign_out');
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`native-session-revoke:${session.user.id}`, 20, 60000))
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  const token = await sessionTokenFrom(req.headers);
  const repo = await getRepositoryAsync();
  let stored = null;
  if (typeof token?.nativeTokenId === 'string') {
    stored = await repo.findNativeRefreshTokenById(session.user.id, token.nativeTokenId);
  } else {
    const hash =
      typeof token?.nativeSessionKey === 'string'
        ? hashRefreshToken(token.nativeSessionKey)
        : null;
    if (hash) stored = await repo.findNativeRefreshTokenByHash(hash);
  }
  if (stored?.userId === session.user.id)
    await repo.revokeNativeRefreshTokenFamily(session.user.id, stored.familyId, 'sign_out');
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { getRepositoryAsync } from '@/lib/data';
import { hashRefreshToken, REFRESH_TOKEN_RE } from '@/lib/auth/refresh-token-hash';
import { presentedNativeFamily } from '@/lib/auth/mobile/session';
import { rateLimit } from '@/lib/rate-limit';
import { readJsonLimited } from '@trainingai/shared/http/request-guards';
import { clientIp } from '@trainingai/shared/http/client-ip';

const Body = z.object({ refreshToken: z.string().regex(REFRESH_TOKEN_RE) }).strict();

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

// Sign-out revokes the device's whole family. The app signs out with its refresh token in the body,
// because a one-day access token (#2076) has often lapsed by then; holding the refresh token is the
// authority to end its own family. Without one, the bearer token names the family as before.
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get('content-type')?.includes('application/json')) {
      if (!rateLimit(`native-session-revoke-ip:${clientIp(req)}`, 20, 60000))
        return json({ error: 'Too many requests' }, 429);
      const read = await readJsonLimited(req, 4 * 1024);
      const parsed = read.ok ? Body.safeParse(read.body) : null;
      if (!parsed?.success) return json({ error: 'Invalid request' }, 400);
      const repo = await getRepositoryAsync();
      const stored = await repo.findNativeRefreshTokenByHash(hashRefreshToken(parsed.data.refreshToken)!);
      if (stored) await repo.revokeNativeRefreshTokenFamily(stored.userId, stored.familyId, 'sign_out');
      return json({ ok: true });
    }
    const session = await auth();
    if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);
    if (!rateLimit(`native-session-revoke:${session.user.id}`, 20, 60000))
      return json({ error: 'Too many requests' }, 429);
    const familyId = await presentedNativeFamily(req.headers, session.user.id);
    if (familyId)
      await (await getRepositoryAsync()).revokeNativeRefreshTokenFamily(session.user.id, familyId, 'sign_out');
    return json({ ok: true });
  } catch {
    // Without the error object: a driver error can quote the statement's parameters (the hash).
    console.error('[native-session/revoke] revoke failed');
    return json({ error: 'Sign-out is temporarily unavailable' }, 503);
  }
}

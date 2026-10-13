import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getRepositoryAsync } from '@/lib/data';
import { sessionTokenFrom } from '@/lib/auth/session-token';
import { hashRefreshToken } from '@/lib/auth/refresh-token-hash';
import { rateLimit } from '@/lib/rate-limit';
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`native-session-revoke:${session.user.id}`, 20, 60000))
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  const token = await sessionTokenFrom(req.headers);
  const hash =
    typeof token?.nativeSessionKey === 'string'
      ? hashRefreshToken(token.nativeSessionKey)
      : null;
  if (hash) {
    const repo = await getRepositoryAsync();
    const stored = await repo.findNativeRefreshTokenByHash(hash);
    if (stored?.userId === session.user.id)
      await repo.revokeNativeRefreshTokenFamily(session.user.id, stored.familyId, 'sign_out');
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { getRepositoryAsync } from '@/lib/data';
import { presentedNativeFamily } from '@/lib/auth/mobile/session';
import { rateLimit } from '@/lib/rate-limit';
import { readJsonLimited } from '@trainingai/shared/http/request-guards';

// #3280. Signs another device out: revokes its refresh-token family with reason `user`. The device
// loses its access token on its next request (the bearer check refuses a revoked family) and cannot
// refresh. The family id is scoped to the caller inside the revoke, so an id from another account
// changes nothing and answers 404, the same as an unknown one. This device is refused: signing out
// of it is `native-session/revoke`, which also clears the app's saved session.

const Body = z.object({ id: z.string().uuid() }).strict();

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);
  const userId = session.user.id;
  if (!rateLimit(`native-devices-revoke:${userId}`, 10, 60000)) return json({ error: 'Too many requests' }, 429);
  const read = await readJsonLimited(req, 1024);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'Request too large' : 'Invalid request' }, read.reason === 'too_large' ? 413 : 400);
  const parsed = Body.safeParse(read.body);
  if (!parsed.success) return json({ error: 'Invalid request' }, 400);
  try {
    if (parsed.data.id === (await presentedNativeFamily(req.headers, userId))) {
      return json({ error: 'Use sign out for this device' }, 409);
    }
    const revoked = await (await getRepositoryAsync()).revokeNativeRefreshTokenFamily(userId, parsed.data.id, 'user');
    if (revoked === 0) return json({ error: 'Device not found' }, 404);
    return json({ ok: true });
  } catch {
    console.error('[native-session/devices/revoke] revoke failed');
    return json({ error: 'Revoking is temporarily unavailable' }, 503);
  }
}

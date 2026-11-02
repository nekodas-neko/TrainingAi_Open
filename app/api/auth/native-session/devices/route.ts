import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getRepositoryAsync } from '@/lib/data';
import { presentedNativeFamily } from '@/lib/auth/mobile/session';
import { rateLimit } from '@/lib/rate-limit';

// #3280. The caller's signed-in devices: one per live refresh-token family. `id` is the family id,
// which `devices/revoke` takes; it is not a credential. No token id and no hash is returned.
// `current` marks the device this request came from, so the screen hides Revoke there.

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);
  const userId = session.user.id;
  if (!rateLimit(`native-devices:${userId}`, 30, 60000)) return json({ error: 'Too many requests' }, 429);
  try {
    const [devices, currentFamily] = await Promise.all([
      (await getRepositoryAsync()).listNativeDevices(userId),
      presentedNativeFamily(req.headers, userId),
    ]);
    return json({
      devices: devices.map((d) => ({
        id: d.familyId,
        label: d.deviceLabel,
        signedInAt: d.signedInAt.toISOString(),
        lastUsedAt: d.lastUsedAt.toISOString(),
        current: d.familyId === currentFamily,
      })),
    });
  } catch {
    console.error('[native-session/devices] list failed');
    return json({ error: 'Devices are temporarily unavailable' }, 503);
  }
}

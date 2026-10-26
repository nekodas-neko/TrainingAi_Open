import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { dataEpochOf } from '@/lib/auth/session-cutoff'

/**
 * #3369 — the moment an admin last reset this account's data, in whole seconds (0 when never).
 *
 * A device records the value it last saw. When the server's is newer, the device holds data from
 * before a reset and wipes it before its next push (`lib/local-store/data-epoch.ts`). The session
 * cut-off already refuses a stale sign-in; this covers the phone that signs in again afterwards
 * with the old rows still in its local store.
 */
export async function GET(req?: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`account-data-epoch:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  try {
    const user = await (await getRepository()).getUserById(userId)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const headers = { 'Cache-Control': 'private, no-store' }
    const epoch = dataEpochOf(user.sessionsValidFrom)
    // A native bearer token is re-stamped at every issue and rotation (`lib/auth/mobile/session.ts`),
    // so its `signedInAt` says when the token was minted, not when the person signed in, and would
    // call every bearer session "fresh". It is left out, which a reader treats as "cannot tell"
    // (`lib/local-store/device-owner.ts`: an unreadable answer keeps the store closed). The native
    // app reads only `epoch`; the owner gate runs only for the cookie sessions of the web/APK shell.
    if (req?.headers.get('authorization')?.toLowerCase().startsWith('bearer ')) {
      return NextResponse.json({ epoch }, { headers })
    }
    // `signedInAt` is null for a session that began before the build that stamps it: the device uses
    // that to tell a carried-over session from a fresh sign-in.
    const signedInAt = typeof session?.signedInAt === 'number' ? session.signedInAt : null
    return NextResponse.json({ epoch, signedInAt }, { headers })
  } catch (err) {
    reportServerError(err, { userId, url: '/api/account/data-epoch' })
    return NextResponse.json({ error: 'Could not read the account' }, { status: 500 })
  }
}

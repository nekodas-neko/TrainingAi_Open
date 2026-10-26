import { NextResponse } from 'next/server'
import { refusalResponse, isRefusal } from '@/lib/api/route-errors'
import { reportServerError } from '@/lib/observability'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

/** The trainee's side: the programs they were given and who sent each. Kept after a revocation. */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`trainer-assigned-to-me:${session.user.id}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }
  try {
    const assignments = await (await getRepositoryAsync()).listProgramsAssignedTo(session.user.id)
    return NextResponse.json({ assignments }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e: unknown) {
    if (!isRefusal(e)) reportServerError(e, { userId: session.user.id, url: '/api/trainer/assigned-to-me' })
    return refusalResponse(e, 'Could not load your assigned programs')
  }
}

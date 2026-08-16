import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepositoryAsync()
  const seasons = await repo.listSeasonsWithResults(session.user.id)
  return NextResponse.json({ seasons }, { headers: { "Cache-Control": "private, no-store" } })
}

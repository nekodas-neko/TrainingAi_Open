import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const exercises = await repo.listExerciseLibrary()
  return NextResponse.json({ exercises }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'

// Phase-B feasibility probe (admin): what motion/HR the ring captured during one workout's window.
// Read-only — tells us whether the neural energy model's inputs (dense workout-window motion) are
// capturable over BLE, or whether the MET fallback (Phase A) stays the ceiling.
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id
  try {
    await requireAdmin(userId, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  // No sessionId → probe the most recent completed workout.
  const sessionId = new URL(req.url).searchParams.get('sessionId')?.trim() || undefined

  const repo = await getRepositoryAsync()
  const probe = await repo.getWorkoutSensorProbe(userId, sessionId)
  if (!probe) return NextResponse.json({ error: 'No completed workout found' }, { status: 404 })
  return NextResponse.json(probe)
}

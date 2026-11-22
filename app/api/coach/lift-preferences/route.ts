import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { errorLog } from '@trainingai/shared/logger'
import { liftPreferenceFromRow } from '@trainingai/shared/ai-periodization/lift-preference'

const CACHE_HEADERS = { 'Cache-Control': 'private, no-store' }
/** `?names=` a JSON array of lift names (a lift's name can hold a comma). */
const NamesSchema = z.array(z.string().trim().min(1).max(200)).min(1).max(80)

/**
 * The rep range each named lift has (#3896 step 7), for the program editor's "Rep range" row. Read
 * only, and only the signed-in user's rows: the names select among them and are bound as parameters,
 * never trusted to name anyone else's. The editor writes through the Coach's apply path
 * (`/api/coach/apply`, the `lift_preference` domain), so there is one writer with one set of rules.
 */
export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:coach-lift-preferences`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let names: unknown = null
  try {
    names = JSON.parse(new URL(req.url).searchParams.get('names') ?? 'null')
  } catch {
    names = null
  }
  const parsed = NamesSchema.safeParse(names)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  try {
    const repo = await getRepositoryAsync()
    const rows = await repo.listExercisePreferences(userId, [...new Set(parsed.data)])
    const preferences: Record<string, { repRange: string | null }> = {}
    for (const name of parsed.data) {
      const range = liftPreferenceFromRow(rows.get(name))?.repRange
      preferences[name] = { repRange: range ? `${range.min}-${range.max}` : null }
    }
    return NextResponse.json({ preferences }, { headers: CACHE_HEADERS })
  } catch (error) {
    errorLog(error, 'API /coach/lift-preferences')
    return NextResponse.json({ error: 'Could not read lift preferences' }, { status: 500 })
  }
}

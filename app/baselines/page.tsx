import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { getRepositoryAsync } from '@/lib/data'
import { DEFAULT_TZ, ageFromDob, todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { resolveHrProfile } from '@trainingai/shared/health/hr-profile'
import { FitnessTestsContent } from '@/components/fitness-tests/fitness-tests-content'

export default async function BaselinesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  const repo = await getRepositoryAsync()
  const tz = session.user.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)
  const [user, metrics, hrProfile] = await Promise.all([
    repo.getUserById(session.user.id),
    repo.listBodyMetrics(session.user.id, shiftDateStr(today, -30), today),
    resolveHrProfile(repo, session.user.id, tz),
  ])

  const age = ageFromDob(user?.dateOfBirth, new Date())
  // Most recent logged weight in the window — feeds the Burr 2011 6MWT VO2max term.
  const latestWeight = metrics
    .filter((m) => m.weightKg != null && m.weightKg > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ?? null
  // Test protocols aim at reachable targets, so they anchor on `targetAnchorMax` — the
  // corroborated observed max when there is one. This page used to hardcode
  // `hrMaxObserved: null`, so every protocol target was pinned to 220−age regardless of
  // what had actually been recorded.
  const profile = {
    age,
    restingHr: hrProfile.restingHr,
    hrMax: hrProfile.targetAnchorMax,
    sex: user?.sex ?? null,
    weightKg: latestWeight,
  }

  return (
    <div className="bg-page h-screen w-full">
      <FitnessTestsContent userId={session.user.id} profile={profile} />
    </div>
  )
}

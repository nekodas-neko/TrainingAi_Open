import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { getRepositoryAsync } from '@/lib/data'
import { DEFAULT_TZ, ageFromDob } from '@trainingai/shared/date-utils'
import { resolveHrProfile } from '@trainingai/shared/health/hr-profile'
import { GuidedWalkContent } from '@/components/guided-walk/guided-walk-content'

export default async function GuidedWalkPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  const repo = await getRepositoryAsync()
  const tz = session.user.timezone ?? DEFAULT_TZ
  const [user, hrProfile] = await Promise.all([
    repo.getUserById(session.user.id),
    resolveHrProfile(repo, session.user.id, tz),
  ])

  // Walk targets anchor on `targetAnchorMax`, not the effort ceiling: the generic 220−age
  // estimate reads as a 20-year-old athlete's max and made the fast block unreachable
  // without jogging. Previously that anchor was the highest single daily observed max
  // across 90 days of body-battery snapshots — a Math.max over values that were themselves
  // a Math.max, so one motion artefact raised the target permanently. It is now
  // corroborated (30–220 bpm band, k-th highest, reliability-gated) inside resolveHrProfile.
  const profile = {
    age: ageFromDob(user?.dateOfBirth, new Date()),
    restingHr: hrProfile.restingHr,
    hrMax: hrProfile.targetAnchorMax,
  }

  return <GuidedWalkContent userId={session.user.id} profile={profile} />
}

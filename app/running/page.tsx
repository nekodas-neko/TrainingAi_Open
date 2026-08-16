import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { RunningPlanContent } from '@/components/running/running-plan-content'

export default async function RunningPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  return (
    <div className="bg-page h-screen w-full">
      <RunningPlanContent userId={session.user.id} />
    </div>
  )
}

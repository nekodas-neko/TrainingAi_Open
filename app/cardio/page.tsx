import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { CardioContent } from '@/components/cardio/cardio-content'

export default async function CardioPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  return (
    <div className="bg-page h-screen w-full">
      <CardioContent />
    </div>
  )
}

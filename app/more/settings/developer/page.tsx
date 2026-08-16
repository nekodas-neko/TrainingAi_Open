import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isAdminUser } from '@/lib/admin'
import { DeveloperContent } from './developer-content'

export default async function DeveloperPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  // Same cosmetic render gate as /admin — every action underneath re-checks authoritatively via
  // requireAdmin, so the possibly-stale JWT flag is an acceptable latency trade here.
  if (!await isAdminUser(session.user.id, session.user.isAdmin)) redirect('/')
  return <DeveloperContent />
}

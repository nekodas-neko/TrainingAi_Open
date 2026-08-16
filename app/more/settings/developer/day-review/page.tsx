import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isAdminUser } from '@/lib/admin'
import { DevToolContent } from './content'

export default async function Page() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  if (!await isAdminUser(session.user.id, session.user.isAdmin)) redirect('/')
  return <DevToolContent />
}

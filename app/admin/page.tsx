import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isAdminUser } from '@/lib/admin'
import AdminContent from './admin-content'
import { BottomNav } from '@/components/shell/bottom-nav'

export default async function AdminPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  // Pass the JWT's isAdmin flag so isAdminUser short-circuits before the DB round-trip —
  // this call site is a cosmetic render gate (every admin action re-checks authoritatively
  // via requireAdmin), so trusting a possibly-stale JWT here is an acceptable latency trade.
  if (!await isAdminUser(session.user.id, session.user.isAdmin)) redirect('/')

  return (
    <>
      <AdminContent />
      <BottomNav isAdmin />
    </>
  )
}

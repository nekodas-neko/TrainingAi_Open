import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { SessionExplainClient } from './session-explain-client'

export default async function SessionExplainPage() {
  const session = await auth()
  if (!session?.user?.id) return notFound()
  return <SessionExplainClient />
}

import { redirect } from 'next/navigation'

export default function StatsPage() {
  redirect('/health?tab=training')
}

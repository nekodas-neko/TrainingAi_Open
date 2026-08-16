import { redirect } from 'next/navigation'

// `/config` was the Program Builder's URL before it had a screen of its own. The Builder is
// `/program` now (Q-235) — it used to mount under a More sub-tab *also* called "Workout", two
// containers away from the Workout tab in the bottom nav.
//
// The query string is forwarded, not dropped. A bare `redirect('/more?tab=workout')` here silently
// swallowed `?new=program`, so the AI prescription card's post-deload "New program" action opened
// the Builder and never opened the sheet (Q-256).
export default async function ConfigPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') qs.set(k, v)
    else if (Array.isArray(v)) v.forEach(x => qs.append(k, x))
  }
  const suffix = qs.toString()
  redirect(suffix ? `/program?${suffix}` : '/program')
}

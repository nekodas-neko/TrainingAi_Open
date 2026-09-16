'use client'

import { CalendarRange, ChevronRight } from 'lucide-react'
import { useTransitionRouter } from '@/lib/view-transition'

/**
 * The permanent way into `/health/week` (BF-5).
 *
 * The owner asked for *"a permanent link in the health tab somewhere"* alongside the banner, and the
 * reason is structural rather than cosmetic: the banner is dismissible and fires once per week, so a
 * page reachable only from it is unreachable for the rest of the week — and permanently unreachable
 * for anyone who dismissed it.
 *
 * `router.push` rather than an anchor: a document navigation inside the WebView reloads the app and
 * throws away every mounted tab.
 */
export function WeekInReviewCard() {
  const router = useTransitionRouter()
  return (
    <button
      type="button"
      onClick={() => router.push('/health/week')}
      className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-border bg-muted/60 px-4 py-3 text-left transition active:scale-[0.99]"
    >
      <CalendarRange className="h-5 w-5 flex-none text-brand" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-tight">Week in review</span>
        <span className="block text-xs text-muted-foreground">Last week&apos;s training, recovery and records</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
    </button>
  )
}

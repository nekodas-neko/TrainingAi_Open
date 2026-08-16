'use client'

import { ChevronLeftIcon } from 'lucide-react'
import { getActivityIcon } from '@trainingai/shared/constants/activity-icons'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useActivityStore } from '@/lib/stores/activity-store'
import { useShallow } from 'zustand/react/shallow'
import { useTransitionRouter } from "@/lib/view-transition";

export function PreActivityScreen() {
  const router = useTransitionRouter()
  const { activityIcon, activityLabel, isDistanceBased, title, setTitle, begin, resetSession } = useActivityStore(
    useShallow(s => ({
      activityIcon: s.activityIcon, activityLabel: s.activityLabel, isDistanceBased: s.isDistanceBased,
      title: s.title, setTitle: s.setTitle, begin: s.begin, resetSession: s.resetSession,
    }))
  )
  const Icon = getActivityIcon(activityIcon)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-4 pb-4 pt-safe">
        <button onClick={() => { resetSession(); router.back() }} aria-label="Go back" className="rounded-lg p-2.5 hover:bg-muted transition">
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">{activityLabel}</h1>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="flex flex-col items-center gap-2">
          <Icon size={48} weight="fill" style={{ color: 'var(--color-brand)' }} />
          <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{activityLabel}</span>
        </div>

        <div className="w-full max-w-xs space-y-1.5">
          <Label htmlFor="activity-title">Title</Label>
          <Input id="activity-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Activity name" />
        </div>

        {isDistanceBased && (
          <p className="max-w-xs text-center text-xs text-muted-foreground">
            Your route, distance and pace will be tracked using GPS, including
            while your screen is off.
          </p>
        )}

        <button
          type="button"
          onClick={begin}
          className="w-full max-w-xs rounded-xl py-3.5 text-sm font-bold transition hover:opacity-90 active:scale-95"
          style={{ background: 'var(--color-brand)', color: "var(--brand-foreground)" }}
        >
          Start
        </button>
      </div>
    </div>
  )
}

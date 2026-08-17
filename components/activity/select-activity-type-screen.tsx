'use client'

import { ChevronLeftIcon } from 'lucide-react'
import { useActivityStore } from '@/lib/stores/activity-store'
import { useTransitionRouter } from '@/lib/view-transition'
import { ActivityTypeGrid } from './activity-type-grid'

/**
 * Shown when `/activity` is opened with no activity type in the store (Q-450).
 *
 * That state is ordinary, not exotic: `resetSession()` clears the type and runs after every save
 * and on the Pre screen's own back button, so it is where the store sits *between* activities. The
 * AI Coach's "Log an activity" handoff and the guided-walk summary's Done button both push
 * `/activity` without setting one, and so does a cold open or a refresh.
 *
 * Before this screen existed the user got a blank Pre screen — an unlabelled title field and a
 * working Start button — and could record a whole activity that `handleSave` then discarded
 * without a word. Picking the type up front is what makes that unreachable.
 */
export function SelectActivityTypeScreen() {
  const router = useTransitionRouter()
  const startActivity = useActivityStore(s => s.startActivity)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-4 pb-4 pt-safe">
        <button
          onClick={() => router.back()}
          aria-label="Go back"
          className="rounded-lg p-2.5 hover:bg-muted transition"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Log Activity</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pt-6">
        <p className="mb-3 text-sm text-muted-foreground">What are you doing?</p>
        <ActivityTypeGrid
          onSelect={type => startActivity(type.id, type.label, type.icon, type.isDistanceBased)}
        />
      </div>
    </div>
  )
}

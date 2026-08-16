'use client'

import { memo, useState } from 'react'
import { Loader2 } from 'lucide-react'

export const GoalsCheckinCard = memo(function GoalsCheckinCard({ onReviewNow, onRemindLater }: { onReviewNow: () => Promise<void>; onRemindLater: () => void }) {
  const [loading, setLoading] = useState(false)
  async function handleReview() {
    setLoading(true)
    await onReviewNow()
    setLoading(false)
  }
  return (
    <div className="rounded-2xl bg-muted/40 border border-border p-4 space-y-2">
      <p className="font-semibold text-sm">Time for a goals check-in</p>
      <p className="text-xs text-muted-foreground">
        It&apos;s been a couple of weeks — review your nutrition and activity goals based on your recent trends.
      </p>
      <div className="flex gap-2 mt-2">
        <button onClick={handleReview} disabled={loading} className="text-xs bg-brand text-primary-foreground rounded-lg px-3 py-1.5 disabled:opacity-60">
          {loading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : 'Review now'}
        </button>
        <button onClick={onRemindLater} className="text-xs text-muted-foreground hover:text-foreground">
          Remind me later
        </button>
      </div>
    </div>
  )
})

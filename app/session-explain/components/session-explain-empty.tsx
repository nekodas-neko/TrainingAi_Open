'use client'
import { ArrowLeftIcon } from 'lucide-react'
import { useTransitionRouter } from "@/lib/view-transition";

export function SessionExplainEmpty({ loading }: { loading: boolean }) {
  const router = useTransitionRouter()
  return (
    <div className="min-h-screen bg-page pb-safe">
      <div className="flex items-center gap-3 px-4 pt-safe pb-2">
        <button
          onClick={() => router.back()}
          className="p-2 -ml-2 rounded-full hover:bg-muted/40 active:scale-90 transition-transform"
          aria-label="Go back"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Why this session?</h1>
      </div>
      <p className="px-4 pt-8 text-sm text-muted-foreground">
        {loading ? 'Loading your recommendation…' : 'No explanation is available for this session.'}
      </p>
    </div>
  )
}

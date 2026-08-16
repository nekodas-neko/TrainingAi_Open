'use client'
import { ArrowLeftIcon } from 'lucide-react'
import type { SessionExplainData } from '@trainingai/shared/session-explain/build-explain-data'
import { ScoreRing } from './components/score-ring'
import { AlternativesCard } from './components/alternatives-card'
import { AiInsightCard } from './components/ai-insight-card'
import { SignalSections } from './components/signal-sections'
import { useTransitionRouter } from "@/lib/view-transition";

export function SessionExplainContent({ data }: { data: SessionExplainData }) {
  const router = useTransitionRouter()
  const { session, overallScore, alternatives } = data

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
        <h1 className="text-lg font-bold">Why {session.name}?</h1>
      </div>

      <div className="px-4 space-y-4 pb-10">
        {/* Narrative first — the readable "why", seeded from cache for instant paint. */}
        <AiInsightCard sessionId={session.id} />

        <ScoreRing score={overallScore} label="Overall readiness for this session" />

        {/* Raw signals grouped + demoted behind a collapsible. */}
        <SignalSections data={data} />

        <AlternativesCard alternatives={alternatives} />
      </div>
    </div>
  )
}

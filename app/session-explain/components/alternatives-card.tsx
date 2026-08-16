import { scoreBand } from '@trainingai/shared/health/score-band'

interface Alternative {
  session: { id: string; name: string }
  overallScore: number
  primaryReason: string
}

export function AlternativesCard({ alternatives }: { alternatives: Alternative[] }) {
  if (alternatives.length === 0) return null
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Alternatives</p>
      {alternatives.map(alt => {
        const band = scoreBand(alt.overallScore)
        return (
          <div key={alt.session.id} className="flex items-center gap-3">
            <span className="font-medium flex-1 truncate">{alt.session.name}</span>
            <span className="text-xs text-muted-foreground truncate">{alt.primaryReason}</span>
            {/* Band label under the number — the colour alone does not say which band it is. */}
            <span className="flex-none w-14 text-right" style={{ color: band.color }}>
              <span className="block font-bold tabular-nums text-sm leading-tight">{alt.overallScore}</span>
              <span className="block text-[9px] font-semibold uppercase tracking-wide leading-tight">{band.label}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

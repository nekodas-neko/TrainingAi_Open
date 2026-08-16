import { scoreBand } from '@trainingai/shared/health/score-band'

export function ScoreRing({ score, label }: { score: number; label: string }) {
  const r = 54
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - score / 100)
  const band = scoreBand(score)
  const color = band.color

  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <div className="relative w-36 h-36">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 132 132">
          <circle cx="66" cy="66" r={r} fill="none" strokeWidth="10" className="stroke-muted/30" />
          <circle
            cx="66" cy="66" r={r} fill="none" strokeWidth="10"
            style={{
              stroke: color,
              strokeDasharray: circumference,
              strokeDashoffset: offset,
              strokeLinecap: 'round',
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold tabular-nums" style={{ color }}>{score}</span>
          <span className="text-xs text-muted-foreground">/100</span>
          {/* The ring and the number are band-coloured; without the label the band is colour-only. */}
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>{band.label}</span>
        </div>
      </div>
      <p className="text-sm text-center text-muted-foreground px-4">{label}</p>
    </div>
  )
}

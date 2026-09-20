import { scoreBand, type ScoreBand } from '@trainingai/shared/health/score-band'

/**
 * The fit ladder's words for the readiness ladder's bands (BF-172).
 *
 * `overallScore` is `recovery·w + balance·w + freshness·w` — **how well this session fits today**,
 * not a measurement of the lifter. It used to run through `scoreBand` and print **HIGH** in green,
 * directly above signals reading *Readiness 37 · Low* and *strong deload advised*. One screen,
 * one word, two different quantities.
 *
 * **Mapped from `scoreBand`'s label rather than re-derived from the score.** CLAUDE.md bans
 * re-deriving the 70/50 thresholds with local label strings — two divergent copies have been found
 * that way before — so the thresholds and the colour stay in the one place that owns them and only
 * the vocabulary changes here.
 *
 * **The word is not optional.** The ring and the number are band-coloured, so dropping it would make
 * the band colour-only, which is the thing this component's own comment was added to prevent.
 */
const FIT_WORD: Record<ScoreBand['label'], string> = {
  High: 'Strong fit',
  Moderate: 'Fair fit',
  Low: 'Poor fit',
}

/**
 * Session-explain's own ring — **one caller**, `session-explain-content.tsx`. The `ScoreRing*`
 * symbols in `components/more/` and `components/oura-score-chip-row.tsx` are an unrelated home
 * preference type, not this component. The fit vocabulary lives here rather than being threaded from
 * the call site because nothing else renders this ring; a second caller would have to choose.
 */
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
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>{FIT_WORD[band.label]}</span>
        </div>
      </div>
      <p className="text-sm text-center text-muted-foreground px-4">{label}</p>
    </div>
  )
}

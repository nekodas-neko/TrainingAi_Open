import { scoreBandByLabel } from '@trainingai/shared/health/score-band'

/**
 * The key that stops a band-coloured bar row being colour-only state: three labelled swatches
 * naming the thresholds the colours encode. Shared so the legend cannot drift from the bars —
 * a legend that disagrees with the chart is worse than none.
 */
export function ScoreBandLegend() {
  return (
    <div className="flex items-center gap-3 pt-0.5 text-[9px] text-muted-foreground">
      <Swatch color={scoreBandByLabel('High')} label="High 70+" />
      <Swatch color={scoreBandByLabel('Moderate')} label="Moderate 50+" />
      <Swatch color={scoreBandByLabel('Low')} label="Low" />
    </div>
  )
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2 w-2 rounded-full flex-none" style={{ background: color }} />
      {label}
    </span>
  )
}

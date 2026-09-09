import type { ReadingGroup } from './measured-overview'

/**
 * One group of measured readings, as a card.
 *
 * Extracted when BF-133's performance half arrived: the daily metrics and the clinical ones are the
 * same shape — label, value, and the date it was read — and a second copy of this markup is a second
 * place every metric on the screen is formatted. That is the trap the entry names about the existing
 * body cards, and it applies to itself.
 */
export function ReadingGroupCard({ title, readings }: ReadingGroup) {
  return (
    <div className="rounded-2xl border border-border bg-muted/40 overflow-hidden">
      <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <div className="divide-y divide-border/60">
        {readings.map(r => (
          <div key={r.label} className="flex items-baseline gap-3 px-4 py-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-sm">{r.label}</p>
              {r.note && <p className="text-[11px] text-muted-foreground">{r.note}</p>}
            </div>
            <p className="text-sm font-semibold tabular-nums">{r.value}</p>
            {/* The date is the difference between a useful dense card and a misleading one: a
                one-off scan sits beside today's step count and reads as equally current without
                it. */}
            <p className="text-[11px] tabular-nums text-muted-foreground w-[68px] text-right">{r.asOf}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

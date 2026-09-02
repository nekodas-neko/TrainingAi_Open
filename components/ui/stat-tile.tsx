/**
 * One number with its label, as the activity screens draw it.
 *
 * Extracted when BF-107 added a fourth tile to the walk summary. The markup already existed twice —
 * `walk-summary.tsx`'s local `Stat` and `done-activity-screen.tsx`'s inline copies — and had already
 * drifted (`rounded-2xl` against `rounded-xl`), which is the drift a shared primitive exists to stop.
 * `done-activity-screen.tsx` still has its copies; converting them is a pure refactor of a file whose
 * behaviour BF-107 does not change, so it is left as a follow-up rather than widening that diff.
 */
export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/60 border border-border px-2 py-3">
      <p className="text-lg font-bold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  )
}

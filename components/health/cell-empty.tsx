/**
 * LB-176 — what a metric cell says when it has no number.
 *
 * "No data" is a statement about the owner's account. When the read that feeds the cell FAILED it is a
 * statement about a request, and printing the first for the second is the defect: at 412 px with every
 * `GET /api/*` down, this screen told him BURNED / BMI / BALANCE / DIST all had no data.
 *
 * The copy is not invented here — `movement-balance-card.tsx` and `weekly-stats-hub.tsx` already say
 * "Couldn't load your …" through `EmptyState`. That component is `py-8` centred, which is right for a
 * card and far too tall for a 2-column cell, so this is the same sentence trimmed to the one line the
 * cell already had.
 */
export function CellEmpty({ failed, className }: { failed: boolean; className?: string }) {
  return (
    <p className={className ?? "text-xs text-muted-foreground"}>
      {failed ? "Couldn't load" : "No data"}
    </p>
  );
}


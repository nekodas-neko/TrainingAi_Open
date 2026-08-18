import { Button } from '@/components/ui/button'

/**
 * The "delete N saved meals?" confirmation.
 *
 * Extracted from `saved-meals-sheet.tsx` when that file hit the 800-line ceiling: it is purely
 * presentational — count in, two callbacks out — so it is the cheapest thing in that file to lift,
 * and lifting it is what `CLAUDE.md` asks for instead of appending to a known hotspot.
 *
 * The two red hex literals it carried were swapped for the `destructive` token on the way across,
 * rather than moved verbatim and the hex ratchet's baseline raised to accept them. They were already
 * the theme's red; nothing needed a literal. (Naming the hex here would trip the ratchet too — it
 * counts comments, which is correct, since a commented-out literal is the usual way one returns.)
 */
export function BulkDeleteConfirm({
  count, deleting, onCancel, onConfirm,
}: {
  count: number
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-sm font-medium">
        Delete {count} saved meal{count === 1 ? '' : 's'}?
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        Food you have already logged is unaffected, and any meal plan built from these keeps its own
        copy.
      </p>
      <div className="mt-2 flex gap-2">
        <Button variant="secondary" size="sm" className="flex-1 min-h-[44px]" onClick={onCancel} disabled={deleting}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" className="flex-1 min-h-[44px]" onClick={onConfirm} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete them'}
        </Button>
      </div>
    </div>
  )
}

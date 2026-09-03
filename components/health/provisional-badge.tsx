import { TriangleAlert } from 'lucide-react'

/**
 * Marks a night whose figures can still change, on the surfaces that show them in full.
 *
 * The Home score chip marks the same state with a bare glyph because it has no room for words;
 * here there is room, and "Still syncing" is the part that answers the question the number raises.
 * One component so the two surfaces cannot drift into saying different things about one night.
 */
export function ProvisionalBadge({ className }: { className?: string }) {
  return (
    <span
      className={
        className ??
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide'
      }
      style={{
        background: 'color-mix(in oklch, var(--accent-amber) 18%, transparent)',
        color: 'var(--accent-amber)',
      }}
    >
      <TriangleAlert className="h-2.5 w-2.5" />
      Still syncing
    </span>
  )
}

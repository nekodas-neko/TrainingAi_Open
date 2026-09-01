import type { LucideIcon } from 'lucide-react'
import { ChevronRight } from 'lucide-react'

/** A labelled group of navigation rows on the More tab — the grouped-list pattern the IA plan
 *  (docs/superpowers/plans/2026-08-14-more-tab-information-architecture.md) moves this screen to.
 *  Extracted when Devices became the second copy of the Admin row's markup.
 *
 *  `label` is optional, and omitting it is the supported way to present ONE row (BF-82): a heading
 *  over a single row is three stacked elements to draw one tappable line, which is what made this
 *  screen read as long and empty at once. `__tests__/more-row-group-arity.test.ts` fails a labelled group
 *  with fewer than two rows; an unlabelled one is a plain card and is exempt by construction. */
export function MoreRowGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div>
      {label && <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>}
      <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden">
        {children}
      </div>
    </div>
  )
}

/** One row: icon, label, optional trailing badges, chevron. A real <button>, so `badges` must stay
 *  non-interactive — interactive content inside a button is invalid HTML with undefined behaviour
 *  in Samsung's WebView, and it escapes the global 44px tap-target floor. */
export function MoreRow({
  icon: Icon, label, onClick, badges,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  badges?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/60 transition"
    >
      <div className="flex items-center gap-3 flex-1">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm">{label}</span>
        {badges}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  )
}

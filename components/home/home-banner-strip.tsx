'use client'

import { ChevronRight, Footprints, Target, ClipboardList, TrendingUp, type LucideIcon } from 'lucide-react'
import { COLLAPSING_BANNERS, useBannersPresent, type CollapsingBanner } from '@/components/home/home-banner-presence'

/** One icon per collapsing banner, in the order the approved mockup draws them. */
const ICON: Record<CollapsingBanner, { icon: LucideIcon; tint: string; label: string }> = {
  exerciseDetected: { icon: Footprints,    tint: 'var(--accent-green)',  label: 'Activity to review' },
  goalsCheckin:     { icon: Target,        tint: 'var(--accent-cyan)',   label: 'Goals check-in' },
  dayReview:        { icon: ClipboardList, tint: 'var(--accent-amber)',  label: 'Day in review' },
  weeklyRecap:      { icon: TrendingUp,    tint: 'var(--accent-purple)', label: 'Week in review' },
}

interface Props {
  expanded: boolean
  onToggle: () => void
}

/**
 * RV-119 — the four "ready for you" banners as one row.
 *
 * Built to [`docs/design/2026-09-28-home-banner-stack.html`](../../docs/design/2026-09-28-home-banner-stack.html)
 * option **A**, which the owner picked on 2026-09-28: icon chips, a count, and a chevron.
 *
 * **The problem it solves is cumulative, not individual.** Each banner self-hides and each is
 * correct on its own; on a Monday after a detected walk with an early-deload flag the owner scrolled
 * past five cards to reach the recommendation — which is why he opens Home at all.
 *
 * **Two banners are deliberately NOT in here.** The illness advisory and the early-deload warning
 * stay full-width above it: they are things he should see *today*, and putting them in a collapsed
 * row beside a weekly recap is how they get missed. The split is by severity, and it is the owner's.
 *
 * **Tapping EXPANDS in place — it does not navigate.** That is the mockup's own note, and it is what
 * lets the four keep the dismiss controls they already have, rather than trading them for height.
 * Renders nothing when none of the four is waiting, so an ordinary day loses no space to it.
 */
export function HomeBannerStrip({ expanded, onToggle }: Props) {
  const present = useBannersPresent()
  const waiting = COLLAPSING_BANNERS.filter(k => present.has(k))
  if (waiting.length === 0) return null

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      data-testid="home-banner-strip"
      className="mx-4 mb-3 w-full max-w-[calc(100%-2rem)] min-h-11 flex items-center gap-2 rounded-2xl border border-border/60 bg-foreground/5 px-3.5 py-2.5 text-left transition-[transform,background-color] duration-100 active:scale-[0.99] motion-reduce:active:scale-100 motion-reduce:transition-none"
    >
      <span className="flex items-center gap-1" aria-hidden>
        {waiting.map(key => {
          const { icon: Icon, tint } = ICON[key]
          return (
            <span
              key={key}
              className="h-6 w-6 rounded-full flex items-center justify-center flex-none"
              style={{ background: `color-mix(in oklch, ${tint} 16%, transparent)` }}
            >
              <Icon className="h-3.5 w-3.5" style={{ color: tint }} />
            </span>
          )
        })}
      </span>
      <span className="text-[13px] font-semibold">
        {waiting.length} ready
      </span>
      {/* The names, for a screen reader — four tinted glyphs and a number say nothing without them. */}
      <span className="sr-only">
        {expanded ? 'Hide' : 'Show'}: {waiting.map(k => ICON[k].label).join(', ')}
      </span>
      <ChevronRight
        className={`ml-auto h-4 w-4 flex-none text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
        aria-hidden
      />
    </button>
  )
}

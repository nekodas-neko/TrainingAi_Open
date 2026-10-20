'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { CollectionState } from '@trainingai/shared/collection/ladder'
import { CatSprite } from '@/components/home/cat-sprite'
import {
  ASSUMED_PEN_W, PEN_HEIGHT, penCatMotion, penCats, shownForWidth, slotOf, tagsForWidth, type PenCat,
} from '@/components/home/collection-pen-cats'
import type { FaucetKey } from '@/components/home/collection-summary'

/**
 * The collection as a pen of cats wandering about, for the Home card.
 *
 * Cats are drawn over a backdrop scene, as many as the pen's measured width fits and spread across
 * tiers rather than taken from the top (`collection-pen-cats.ts`), with a name tag on the rarest few. **Depth follows tier**, the owner's layout: T1s are
 * small and at the front, each tier up stands further back and higher, and T5–T6 fly above the
 * ground with a shadow beneath. So the rare cats are the ones that stand out, never the ones hidden
 * behind a crowd. The sprites animate themselves (tail, paws, blink) inside their SVGs; the walk
 * is CSS only (`ta-pen-*` in globals.css), so nothing here re-renders on a timer. It pauses when
 * the card is off screen, when its tab is idle and when the app is backgrounded, and stops under
 * reduced motion.
 *
 * Positions are seeded from each cat's identity rather than `Math.random`, so a re-render (or a
 * revalidation that returns the same stock) does not reshuffle the pen.
 */

/** Backdrops, all drawn; which trophy unlocks which is PS-51. */
export type PenScene = 'meadow' | 'forest' | 'house' | 'castle' | 'gym' | 'park' | 'bedroom' | 'kitchen' | 'beach' | 'snow' | 'space' | 'sakura'

function catStyle(cat: PenCat, slot: number, slots: number): CSSProperties {
  const m = penCatMotion(cat, slot, slots)
  return {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: m.size,
    zIndex: m.zIndex,
    ['--pen-x0' as string]: `calc((var(--pen-w, 300px) - ${m.size}px) * ${m.from.toFixed(3)})`,
    ['--pen-x1' as string]: `calc((var(--pen-w, 300px) - ${m.size}px) * ${m.to.toFixed(3)})`,
    ['--pen-y0' as string]: `${-m.y0}px`,
    ['--pen-y1' as string]: `${-m.y1}px`,
    ['--pen-s0' as string]: '1',
    ['--pen-s1' as string]: '1',
    ['--pen-dur' as string]: `${m.dur.toFixed(1)}s`,
    ['--pen-delay' as string]: `${(-m.offset).toFixed(1)}s`,
  }
}

export const CollectionPen = memo(function CollectionPen({ collections, scene = 'meadow' }: { collections: Partial<Record<FaucetKey, CollectionState>>; scene?: PenScene }) {
  const pen = useRef<HTMLDivElement>(null)
  // BF-204: how many cats and how many name tags fit is a function of the width, not a constant —
  // twelve into 348 px was 1.72× in sprite and 1.31× in tags, i.e. crowded by construction.
  const [penW, setPenW] = useState(ASSUMED_PEN_W)
  const { shown, total } = useMemo(() => penCats(collections, shownForWidth(penW)), [collections, penW])
  const tags = tagsForWidth(penW)

  useEffect(() => {
    const el = pen.current
    if (!el) return
    // The walk distance is in px, and a transform cannot use the parent's width as a percentage.
    const size = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      el.style.setProperty('--pen-w', `${w}px`)
      // Guarded: the observer fires on every scroll-driven relayout, and an unconditional setState
      // here would re-run `penCats` and reseed nothing but still re-render the whole pen.
      setPenW(prev => (prev === w || w === 0 ? prev : w))
    })
    const seen = new IntersectionObserver(([entry]) => { el.dataset.paused = entry.isIntersecting ? 'false' : 'true' })
    size.observe(el)
    seen.observe(el)
    return () => { size.disconnect(); seen.disconnect() }
  }, [])

  if (total === 0) return null

  return (
    <div
      ref={pen}
      className="pen relative overflow-hidden rounded-xl bg-muted bg-cover bg-bottom"
      style={{ height: PEN_HEIGHT, backgroundImage: `url(/cats/scene-${scene}.svg)` }}
      aria-hidden="true"
    >
      {shown.map((cat, i) => {
        const { size, flying } = penCatMotion(cat, 0, 1)
        return (
          <div key={cat.id} className="pen-cat" style={catStyle(cat, slotOf(i, shown.length), shown.length)}>
            {/* Ground shadow: under the feet for walkers, far below and fainter for flyers. */}
            <span
              className="pen-shadow absolute left-1/2 -translate-x-1/2 rounded-full bg-black"
              style={{ width: size * 0.7, height: size * 0.14, bottom: flying ? -34 : -2, opacity: flying ? 0.22 : 0.4 }}
            />
            <div className={flying ? 'pen-fly' : undefined}>
              <div className="pen-cat-face">
                <CatSprite faucet={cat.faucet} tier={cat.tier} size={size} />
              </div>
            </div>
            {/* Tags for the rarest few only (BF-204). `shown` is round-robin from the top tier
                down, so taking the first `tags` of it IS rarest-first. Twelve tags at 348 px
                clipped each other mid-word, which was the loudest half of the defect. */}
            {cat.name && i < tags && (
              <span className="absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap rounded bg-background/80 px-1 text-[9px] font-semibold leading-tight text-foreground">
                {cat.name}
              </span>
            )}
          </div>
        )
      })}
      {/* A caption, not a chip (BF-208). It was `rounded-full bg-background/70 px-1.5` — a pill, in
          the top-right corner, 30 px from a bright disc that also reads as a control. It is a
          `<span>` inside an `aria-hidden` subtree and does nothing; the whole card is the link to
          `/collection`, so making it a real button would put a second tap target for the same
          destination inside the first. The text shadow replaces the plate the background gave it,
          since the scene behind it is anything from a night sky to a kitchen wall. */}
      {total > shown.length && (
        <span className="absolute right-2.5 top-2 text-[10px] font-semibold text-white/75 [text-shadow:0_1px_2px_rgba(0,0,0,0.85)]">+{total - shown.length} more</span>
      )}
    </div>
  )
})

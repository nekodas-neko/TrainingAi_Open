'use client'

import { memo, useEffect, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { CollectionState } from '@trainingai/shared/collection/ladder'
import { CatSprite } from '@/components/home/cat-sprite'
import { penCats, seeded, type PenCat } from '@/components/home/collection-pen-cats'
import type { FaucetKey } from '@/components/home/collection-summary'

/**
 * The collection as a pen of cats wandering about, for the Home card.
 *
 * Every held cat is drawn, highest tiers first, up to `MAX_SHOWN` (`collection-pen-cats.ts`), over a
 * backdrop scene. Each cat wanders between two points anywhere on the ground, shrinking a little as it
 * moves back; bigger tiers are bigger. The sprites animate themselves (tail, paws, blink) inside
 * their SVGs. The motion is CSS only (`ta-pen-*` in globals.css), so nothing here re-renders
 * on a timer. It pauses when the card is off screen, when its tab is idle and when the app is
 * backgrounded, and stops entirely under reduced motion.
 *
 * Positions are seeded from each cat's identity rather than `Math.random`, so a re-render (or a
 * revalidation that returns the same stock) does not reshuffle the pen.
 */

const PEN_HEIGHT = 150
/** How far up the pen a cat may walk — the scenes' ground is the lower third. */
const GROUND = 46
export type PenScene = 'meadow' | 'forest' | 'house' | 'castle'
/** Sprite size per engine tier, T1 first. */
const SIZE = [34, 42, 50, 58, 64, 72]

function catStyle(cat: PenCat, slot: number, slots: number): CSSProperties {
  const size = SIZE[Math.min(cat.tier, SIZE.length - 1)]
  // Each cat starts in its own slice of the width, so the pen fills edge to edge instead of piling up
  // where the hash happens to cluster, then wanders up to a third of the pen either way.
  const from = (slot + seeded(cat.id, 1)) / slots
  const to = Math.min(1, Math.max(0, from + (seeded(cat.id, 2) - 0.5) * 0.66))
  const dur = 10 + seeded(cat.id, 3) * 9
  const y0 = Math.round(seeded(cat.id, 4) * GROUND)
  const y1 = Math.round(seeded(cat.id, 7) * GROUND)
  // Stacking follows the nearer end of the walk; a cat crossing depth mid-walk is rare enough to live with.
  const near = Math.min(y0, y1)
  return {
    position: 'absolute',
    left: 0,
    bottom: 0,
    zIndex: 100 - near,
    ['--pen-x0' as string]: `calc((var(--pen-w, 300px) - ${size}px) * ${from.toFixed(3)})`,
    ['--pen-x1' as string]: `calc((var(--pen-w, 300px) - ${size}px) * ${to.toFixed(3)})`,
    ['--pen-y0' as string]: `${-y0}px`,
    ['--pen-y1' as string]: `${-y1}px`,
    ['--pen-s0' as string]: (1 - y0 / 230).toFixed(3),
    ['--pen-s1' as string]: (1 - y1 / 230).toFixed(3),
    ['--pen-dur' as string]: `${dur.toFixed(1)}s`,
    ['--pen-delay' as string]: `${(-seeded(cat.id, 5) * dur).toFixed(1)}s`,
  }
}

/** Interleaves slots so the biggest cats (listed first) land spread out, not all at the left. */
function slotOf(i: number, n: number): number {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const step = [7, 5, 3, 1].find(k => gcd(k, n) === 1) ?? 1
  return (i * step) % n
}

export const CollectionPen = memo(function CollectionPen({ collections, scene = 'meadow' }: { collections: Partial<Record<FaucetKey, CollectionState>>; scene?: PenScene }) {
  const pen = useRef<HTMLDivElement>(null)
  const { shown, total } = useMemo(() => penCats(collections), [collections])

  useEffect(() => {
    const el = pen.current
    if (!el) return
    // The walk distance is in px, and a transform cannot use the parent's width as a percentage.
    const size = new ResizeObserver(([entry]) => el.style.setProperty('--pen-w', `${Math.round(entry.contentRect.width)}px`))
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
      {shown.map((cat, i) => (
        <div key={cat.id} className="pen-cat" style={catStyle(cat, slotOf(i, shown.length), shown.length)}>
          <div className="pen-cat-face">
            <CatSprite faucet={cat.faucet} tier={cat.tier} size={SIZE[Math.min(cat.tier, SIZE.length - 1)]} />
          </div>
        </div>
      ))}
      {total > shown.length && (
        <span className="absolute right-2 top-1.5 rounded-full bg-background/70 px-1.5 text-[10px] font-semibold text-muted-foreground">+{total - shown.length} more</span>
      )}
    </div>
  )
})

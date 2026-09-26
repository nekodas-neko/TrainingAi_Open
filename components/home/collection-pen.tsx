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
 * backdrop scene, each with its name on a tag. **Depth follows tier**, the owner's layout: T1s are
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

const PEN_HEIGHT = 176
/** Backdrops, all drawn; which trophy unlocks which is PS-51. */
export type PenScene = 'meadow' | 'forest' | 'house' | 'castle' | 'gym' | 'park' | 'bedroom' | 'kitchen' | 'beach' | 'snow' | 'space' | 'sakura'
/** Sprite size per engine tier, T1 first. */
const SIZE = [34, 42, 50, 58, 64, 72]
/** Lowest and highest walking line per tier, in px up from the pen's floor. T5 and T6 are in the air;
 *  the front row starts 14px up so its name tags stay inside the pen. */
const BAND: [number, number][] = [[14, 24], [22, 34], [32, 44], [42, 54], [70, 86], [80, 94]]
const FLYING_FROM_TIER = 4

const sizeOf = (tier: number) => SIZE[Math.min(tier, SIZE.length - 1)]

function catStyle(cat: PenCat, slot: number, slots: number): CSSProperties {
  const size = sizeOf(cat.tier)
  const [lo, hi] = BAND[Math.min(cat.tier, BAND.length - 1)]
  // Each cat starts in its own slice of the width, so the pen fills edge to edge instead of piling up
  // where the hash happens to cluster, then wanders up to a third of the pen either way.
  const from = (slot + seeded(cat.id, 1)) / slots
  const to = Math.min(1, Math.max(0, from + (seeded(cat.id, 2) - 0.5) * 0.66))
  const dur = 10 + seeded(cat.id, 3) * 9
  const y0 = Math.round(lo + seeded(cat.id, 4) * (hi - lo))
  const y1 = Math.round(lo + seeded(cat.id, 7) * (hi - lo))
  return {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: size,
    // Smaller tiers are nearer, so they draw over the ones behind; tier is the depth.
    zIndex: 100 - cat.tier * 10,
    ['--pen-x0' as string]: `calc((var(--pen-w, 300px) - ${size}px) * ${from.toFixed(3)})`,
    ['--pen-x1' as string]: `calc((var(--pen-w, 300px) - ${size}px) * ${to.toFixed(3)})`,
    ['--pen-y0' as string]: `${-y0}px`,
    ['--pen-y1' as string]: `${-y1}px`,
    ['--pen-s0' as string]: '1',
    ['--pen-s1' as string]: '1',
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
      {shown.map((cat, i) => {
        const size = sizeOf(cat.tier)
        const flying = cat.tier >= FLYING_FROM_TIER
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
            {cat.name && (
              <span className="absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap rounded bg-background/80 px-1 text-[9px] font-semibold leading-tight text-foreground">
                {cat.name}
              </span>
            )}
          </div>
        )
      })}
      {total > shown.length && (
        <span className="absolute right-2 top-1.5 rounded-full bg-background/70 px-1.5 text-[10px] font-semibold text-muted-foreground">+{total - shown.length} more</span>
      )}
    </div>
  )
})

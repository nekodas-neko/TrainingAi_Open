'use client'

import { memo } from 'react'
import { Utensils } from 'lucide-react'
import { cn } from '@trainingai/shared/utils'

interface Props {
  /** A stored `data:` URI, or null/undefined for the placeholder. */
  src?: string | null
  /** Tile edge in px. 40 in a list row (artboards 1 and 3); larger for a hero band. */
  size?: number
  className?: string
}

/**
 * The tile a meal is identified by — its photo, or the placeholder (BF-32).
 *
 * **The placeholder is the always-present state, not a fallback bolted on afterwards.** The owner's
 * instruction was *"it should show the default one in the mockup if no image is attached"*, and the
 * artboards draw the same tile nine times with identical values. A row without the box makes the
 * list read as ragged, which is the whole reason this exists rather than rendering nothing when
 * `src` is null.
 *
 * **Props are scalars.** This renders inside `.map()`, where a call site cannot memoise an object
 * and one would silently defeat `React.memo` — the same reason `food-row.tsx` and
 * `meal-macro-bars.tsx` take scalars (Q-490).
 *
 * **The `<img>` needs no host exemption.** `food-row.tsx` recorded an objection to building this
 * early — an `<img>` for an arbitrary remote URL costs a `no-img-element` exemption and a loader
 * decision. A saved meal's photo is a `data:` URI downscaled to 128 px WebP by `MealPhotoTile`, so
 * neither applies. Do not widen `src` to accept a remote URL without re-opening that question.
 */
export const MealThumb = memo(function MealThumb({ src, size = 40, className }: Props) {
  const radius = Math.round(size * 0.225) // 9px at 40px, per the artboards
  return (
    <span
      className={cn('flex flex-none items-center justify-center overflow-hidden', className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        // Structure from the artboards, colours from tokens (BF-28 rule 3). The gradient is
        // deliberately NOT brand-tinted: `data-brand` is user-picked and this is decoration for
        // "a meal", not a brand surface, so it should not change under the accent picker.
        backgroundImage: 'linear-gradient(140deg, var(--meal-tile-from), var(--meal-tile-to))',
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- data: URI, fixed 128px source
        <img src={src} alt="" width={size} height={size} className="h-full w-full object-cover" />
      ) : (
        <Utensils
          style={{ width: Math.round(size * 0.425), height: Math.round(size * 0.425) }}
          strokeWidth={1.6}
          className="text-white/45"
        />
      )}
    </span>
  )
})

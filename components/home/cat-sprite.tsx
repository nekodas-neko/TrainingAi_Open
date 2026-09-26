'use client'

import { useState } from 'react'
import { tierArt, tierGlyph } from '@/components/home/collection-sprites'
import type { FaucetKey } from '@/components/home/collection-summary'

/**
 * One collection tier: the drawn cat, or its glyph if the art cannot load. Decorative — every render
 * site names the tier in text beside it.
 */
export function CatSprite({ faucet, tier, size }: { faucet: FaucetKey; tier: number; size: number }) {
  const [failed, setFailed] = useState(false)
  const src = tierArt(faucet, tier)

  if (!src || failed) {
    return (
      <span className="leading-none" style={{ fontSize: Math.round(size * 0.6) }} aria-hidden="true">
        {tierGlyph(faucet, tier)}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG; next/image adds nothing for a vector
    <img src={src} width={size} height={size} alt="" aria-hidden="true" className="flex-none" onError={() => setFailed(true)} />
  )
}

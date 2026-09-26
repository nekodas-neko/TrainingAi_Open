'use client'

import { useEffect, useRef, useState } from 'react'
import { tierArt, tierGlyph, type CatVariant } from '@/components/home/collection-sprites'
import type { FaucetKey } from '@/components/home/collection-summary'

/**
 * One collection tier: the drawn cat, or its glyph if the art cannot load. Decorative — every render
 * site names the tier in text beside it.
 */
export function CatSprite({ faucet, tier, size, variant }: { faucet: FaucetKey; tier: number; size: number; variant?: CatVariant }) {
  const [failed, setFailed] = useState(false)
  const img = useRef<HTMLImageElement>(null)
  const src = tierArt(faucet, tier, variant)

  // A server-rendered <img> starts loading before hydration, so a load that fails first fires its
  // `error` event before React has attached `onError`, and the tier shows a broken-image box instead
  // of the glyph. Seen on `pnpm dev`, where an unauthenticated request for the SVG 307s to /sign-in:
  // whether the box or the glyph appeared depended on which finished first. Checking on mount
  // catches the error that already happened.
  useEffect(() => {
    const el = img.current
    if (el && el.complete && el.naturalWidth === 0) setFailed(true)
  }, [src])

  if (!src || failed) {
    return (
      <span className="leading-none" style={{ fontSize: Math.round(size * 0.6) }} aria-hidden="true">
        {tierGlyph(faucet, tier)}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG; next/image adds nothing for a vector
    <img ref={img} src={src} width={size} height={size} alt="" aria-hidden="true" className="flex-none" onError={() => setFailed(true)} />
  )
}

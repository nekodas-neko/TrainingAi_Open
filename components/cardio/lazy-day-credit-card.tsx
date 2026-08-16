'use client'

import { memo } from 'react'
import { Footprints } from 'lucide-react'

interface Props {
  zone1Min: number
}

/** Shown only on days with no dedicated workout/cardio session logged (Q-88) — a separate,
 *  complementary "you still moved" signal. Deliberately does NOT feed the training quota
 *  (spec D-10 stays intact): Zone 1 filling passively must not read as "training done". */
function LazyDayCreditCardImpl({ zone1Min }: Props) {
  if (zone1Min <= 0) return null

  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <Footprints className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--accent-cyan)' }} aria-hidden />
      <p className="text-xs leading-snug">
        <b>No dedicated workout today — {zone1Min} min moved (Zone 1).</b>{' '}
        <span className="text-[color:var(--muted-foreground)]">
          Doesn&rsquo;t count toward your training quota, but it&rsquo;s still credit for staying active.
        </span>
      </p>
    </div>
  )
}

export const LazyDayCreditCard = memo(LazyDayCreditCardImpl)

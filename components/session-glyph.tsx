'use client'

import { getSessionIcon } from '@/lib/session-icon'
import { cn } from '@trainingai/shared/utils'

/**
 * A session's icon, resolved — never the raw stored value (RV-214 ①).
 *
 * `ProgramSession.icon` is a free-text column. Every surface that rendered it directly printed
 * whatever was in it: an emoji if it held one, and a **word** if it held an icon name, at whatever
 * size the slot was styled for. On the recommendation card that meant a 30 px "Dumbbell" beside a
 * 20 px session name — the largest text on the card was not the thing being chosen.
 *
 * `getSessionIcon` (`lib/session-icon.tsx`) already existed and already had the fallback chain:
 * the emoji→Lucide map, then the palette position, then `Dumbbell`. A-7 converted
 * `ai-periodization-status-card` and left a comment claiming *"every other session surface uses
 * getSessionIcon"* — three did not. This component exists so the next surface has something
 * shorter to reach for than the raw field.
 */
export function SessionGlyph(
  { icon, palettePosition, className }: {
    icon?: string | null
    /** Falls back to this palette slot's icon when the stored value maps to nothing. */
    palettePosition?: number
    className?: string
  },
) {
  const Icon = getSessionIcon(icon, palettePosition)
  return <Icon className={cn('flex-none', className)} aria-hidden />
}

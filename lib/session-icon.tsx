import type { LucideIcon } from 'lucide-react'
import { SESSION_ICON_CHOICES } from '@trainingai/shared/session-icons'
import {
  Dumbbell,
  Footprints,
  Activity,
  Zap,
  Flame,
  Target,
  Award,
  Brain,
  Bike,
  Waves,
  Users,
  Mountain,
  Swords,
  Wind,
  Heart,
  Timer,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'

// Maps emoji characters (stored in program_sessions.icon) to Lucide icon components
const EMOJI_ICON_MAP: Record<string, LucideIcon> = {
  '💪': Dumbbell,
  '🏋️': Dumbbell,
  '🦵': Footprints,
  '🏃': Activity,
  '🤸': Activity,
  '⚡': Zap,
  '🔥': Flame,
  '🎯': Target,
  '🏅': Award,
  '🧘': Brain,
  '🚴': Bike,
  '🏊': Waves,
  '🤼': Users,
  '🥊': Swords,
  '🧗': Mountain,
  '⛹️': Dumbbell,
  '🤾': Dumbbell,
  '🎽': Dumbbell,
  '🦾': Dumbbell,
  '🏇': Wind,
  // Directional triangles often used for Upper/Lower
  '🔺': TrendingUp,
  '🔻': TrendingDown,
  // Other common fitness emojis
  '❤️': Heart,
  '⏱️': Timer,
  '🏆': Award,
  '🎖️': Award,
  '🩺': Heart,
}

// Palette position → Lucide icon (fallback when no icon stored in DB)
const PALETTE_ICONS: LucideIcon[] = [
  Dumbbell,   // 0 – amber
  Dumbbell,   // 1 – green
  Footprints, // 2 – indigo
  Activity,   // 3 – blue
  Brain,      // 4 – purple
  Zap,        // 5 – red
]

export function getSessionIcon(emoji: string | null | undefined, palettePosition?: number): LucideIcon {
  if (emoji) {
    const mapped = EMOJI_ICON_MAP[emoji]
    if (mapped) return mapped
  }
  if (palettePosition !== undefined) {
    return PALETTE_ICONS[palettePosition % PALETTE_ICONS.length] ?? Dumbbell
  }
  return Dumbbell
}

// FITNESS_ICONS: the icon picker's options in the config screen. The emoji + label list is shared
// with the native app (packages/shared/src/session-icons.ts); only the glyph is chosen here.
// The picker has always drawn the machine arm as a bolt, though a stored 🦾 renders as a dumbbell.
export const FITNESS_ICONS: Array<{ emoji: string; Icon: LucideIcon; label: string }> =
  SESSION_ICON_CHOICES.map(({ emoji, label }) => ({
    emoji,
    label,
    Icon: emoji === '🦾' ? Zap : getSessionIcon(emoji),
  }))

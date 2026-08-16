import type { LucideIcon } from 'lucide-react'
import {
  Dumbbell, Footprints, Activity, Zap, Flame, Target, Award,
  Brain, Bike, Waves, Users, Mountain, ChevronDown, ChevronUp,
  Swords, Wind, Heart, Timer, TrendingUp, TrendingDown,
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

// FITNESS_ICONS: ordered list matching the old FITNESS_EMOJIS array in program-editor-sheet
// Used to populate the icon picker in the config screen
export const FITNESS_ICONS: Array<{ emoji: string; Icon: LucideIcon; label: string }> = [
  { emoji: '💪', Icon: Dumbbell,   label: 'Strength'   },
  { emoji: '🏋️', Icon: Dumbbell,   label: 'Weights'    },
  { emoji: '🦵', Icon: Footprints, label: 'Legs'       },
  { emoji: '🏃', Icon: Activity,   label: 'Cardio'     },
  { emoji: '🤸', Icon: Activity,   label: 'Gymnastics' },
  { emoji: '⚡', Icon: Zap,        label: 'Power'      },
  { emoji: '🔥', Icon: Flame,      label: 'Intensity'  },
  { emoji: '🎯', Icon: Target,     label: 'Focus'      },
  { emoji: '🏅', Icon: Award,      label: 'Medal'      },
  { emoji: '🧘', Icon: Brain,      label: 'Mind'       },
  { emoji: '🚴', Icon: Bike,       label: 'Cycling'    },
  { emoji: '🏊', Icon: Waves,      label: 'Swimming'   },
  { emoji: '🤼', Icon: Users,      label: 'Sparring'   },
  { emoji: '🥊', Icon: Swords,     label: 'Boxing'     },
  { emoji: '🧗', Icon: Mountain,   label: 'Climbing'   },
  { emoji: '⛹️', Icon: Dumbbell,   label: 'Sport'      },
  { emoji: '🤾', Icon: Dumbbell,   label: 'Handball'   },
  { emoji: '🎽', Icon: Dumbbell,   label: 'Athletics'  },
  { emoji: '🦾', Icon: Zap,        label: 'Machine'    },
  { emoji: '🏇', Icon: Wind,       label: 'Speed'      },
  { emoji: '🔺', Icon: TrendingUp,   label: 'Upper'   },
  { emoji: '🔻', Icon: TrendingDown, label: 'Lower'   },
]

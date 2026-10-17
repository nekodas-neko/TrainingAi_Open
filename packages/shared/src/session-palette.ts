export interface PaletteEntry {
  emoji: string
  color: string           // Tailwind color name, e.g. "amber"
  bgClass: string         // e.g. "bg-amber-500/20"
  textClass: string       // e.g. "text-amber-400"
  borderClass: string     // e.g. "border-amber-500/30"
  dotClass: string        // e.g. "bg-amber-500" (solid, for calendar dots)
}

export const SESSION_PALETTE: PaletteEntry[] = [
  { emoji: '💪', color: 'amber',  bgClass: 'bg-amber-500/20',  textClass: 'text-amber-400',  borderClass: 'border-amber-500/30',  dotClass: 'bg-amber-500'  },
  { emoji: '🏋️', color: 'green',  bgClass: 'bg-green-500/20',  textClass: 'text-green-400',  borderClass: 'border-green-500/30',  dotClass: 'bg-green-500'  },
  { emoji: '🦵', color: 'indigo', bgClass: 'bg-indigo-500/20', textClass: 'text-indigo-400', borderClass: 'border-indigo-500/30', dotClass: 'bg-indigo-500' },
  { emoji: '🏃', color: 'blue',   bgClass: 'bg-blue-500/20',   textClass: 'text-blue-400',   borderClass: 'border-blue-500/30',   dotClass: 'bg-blue-500'   },
  { emoji: '🤸', color: 'purple', bgClass: 'bg-purple-500/20', textClass: 'text-purple-400', borderClass: 'border-purple-500/30', dotClass: 'bg-purple-500' },
  { emoji: '⚡', color: 'red',    bgClass: 'bg-red-500/20',    textClass: 'text-red-400',    borderClass: 'border-red-500/30',    dotClass: 'bg-red-500'    },
]

export function getPaletteEntry(position: number): PaletteEntry {
  return SESSION_PALETTE[position % SESSION_PALETTE.length]
}

/**
 * The palette position of a session by name: the program's own position when the name is one of
 * its sessions, else a stable hash so an old ad-hoc session keeps one colour. The calendar, the
 * weekly load bars and the legends all read this, so a session is one colour on every screen.
 */
export function sessionPaletteIndex(
  name: string,
  sessions: readonly { name: string; position: number }[],
): number {
  const lower = name.toLowerCase()
  const known = sessions.find((s) => s.name.toLowerCase() === lower)
  if (known) return known.position
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h
}

/** Strip parenthetical muscle annotations and cap length for legend display.
 *  "Push A (Chest/Shoulders/Triceps)" → "Push A" */
export function shortSessionName(name: string): string {
  const stripped = name.replace(/\s*\([^)]*\)\s*/g, '').trim()
  return stripped.length > 14 ? stripped.slice(0, 13).trimEnd() + '…' : stripped
}

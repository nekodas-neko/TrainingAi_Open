// The session icons a user can pick in the program editor. Each is stored as
// its emoji in program_sessions.icon; the glyph drawn for it is per-app
// (lib/session-icon.tsx on the web build, SessionGlyph in mobile/).
export const SESSION_ICON_CHOICES: ReadonlyArray<{ emoji: string; label: string }> = [
  { emoji: '💪', label: 'Strength' },
  { emoji: '🏋️', label: 'Weights' },
  { emoji: '🦵', label: 'Legs' },
  { emoji: '🏃', label: 'Cardio' },
  { emoji: '🤸', label: 'Gymnastics' },
  { emoji: '⚡', label: 'Power' },
  { emoji: '🔥', label: 'Intensity' },
  { emoji: '🎯', label: 'Focus' },
  { emoji: '🏅', label: 'Medal' },
  { emoji: '🧘', label: 'Mind' },
  { emoji: '🚴', label: 'Cycling' },
  { emoji: '🏊', label: 'Swimming' },
  { emoji: '🤼', label: 'Sparring' },
  { emoji: '🥊', label: 'Boxing' },
  { emoji: '🧗', label: 'Climbing' },
  { emoji: '⛹️', label: 'Sport' },
  { emoji: '🤾', label: 'Handball' },
  { emoji: '🎽', label: 'Athletics' },
  { emoji: '🦾', label: 'Machine' },
  { emoji: '🏇', label: 'Speed' },
  { emoji: '🔺', label: 'Upper' },
  { emoji: '🔻', label: 'Lower' },
]

export interface GeneratedExercise {
  name: string
  exerciseRole: 'primary' | 'secondary' | 'accessory'
  mainMuscles: string[]
  secondaryMuscles: string[]
  progressionStyleName?: string  // style name returned by AI e.g. "Strength 4-set"
  progressionStyleId?: string    // resolved server-side from name → UUID
  clientId?: string              // stable React key for the review editor; minted client-side, dropped on save
}

export interface GeneratedSession {
  name: string
  icon: string
  exercises: GeneratedExercise[]
}

export interface GeneratedPhase {
  name: string
  durationCycles: number
  phaseType: string
  primaryStyleName?: string
}

export interface GeneratedProgram {
  name: string
  sessions: GeneratedSession[]
  phaseStructureName: string
  phaseSetId: string
  reasoning: string
  phases: GeneratedPhase[]
}

export interface BuilderInputs {
  programName: string
  equipment: string[]
  sessionsPerWeek: number
  timePerSessionMinutes: number | null
  musclesToFocus: string[]
  goal: 'hypertrophy' | 'strength+hypertrophy' | 'powerbuilding' | 'strength'
  progressionMode: 'linear' | 'phase' | 'ai'
  phaseStructureName: string
  totalWeeks: number
  scheduleType: 'rotation' | 'weekly'
  rotationRestAfterN: number
  weeklyDays: number[]  // 0=Mon … 6=Sun
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

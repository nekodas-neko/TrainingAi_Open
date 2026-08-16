export interface StyleSet {
  id: string
  styleId: string
  setNumber: number
  pct: number
  reps: number
  restSec: number
  useFor1rm: boolean
}

export interface ProgressionStyle {
  id: string
  userId: string
  name: string
  sets: StyleSet[]
}

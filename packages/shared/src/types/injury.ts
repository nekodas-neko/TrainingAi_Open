export interface Injury {
  id: string
  userId: string
  muscleName: string
  notes: string | null
  severity: 'mild' | 'moderate' | 'severe'
  startedDate: string   // "YYYY-MM-DD"
  resolvedDate: string | null
  createdAt: string
  updatedAt: string
}

export interface Supplement {
  id: string
  userId: string
  name: string
  dose: string | null
  reminderEnabled: boolean
  reminderTime: string | null  // "HH:MM" 24h
  sortOrder: number
  active: boolean
  createdAt: string
}

export interface SupplementWithStatus extends Supplement {
  loggedToday: boolean
}

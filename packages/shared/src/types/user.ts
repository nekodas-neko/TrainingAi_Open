export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active', 'extra_active'] as const
export type ActivityLevel = typeof ACTIVITY_LEVELS[number]

export const FITNESS_GOALS = ['lose_weight', 'maintain', 'build_muscle', 'recomp'] as const
export type FitnessGoal = typeof FITNESS_GOALS[number]

export interface User {
  id: string
  oauthSub?: string   // null for email/password accounts
  email: string
  name?: string
  isActive: boolean
  isAdmin: boolean
  createdAt: Date
  displayName?: string
  heightCm?: number
  dateOfBirth?: string   // 'YYYY-MM-DD'
  weightGoalKg?: number
  avatar?: string        // base64 data URL
  timezone: string       // IANA timezone, e.g. 'Australia/Brisbane'
  sex?: string | null    // 'male' | 'female' | 'other' | null
  friendCode?: string | null
  equippedTitle?: string | null
  activityLevel?: ActivityLevel | null
  fitnessGoal?: FitnessGoal | null
  lastGoalReviewAt?: Date | null
}

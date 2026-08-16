import type { ActivityLevel } from './user'

export const GOAL_RECOMMENDATION_SOURCES = ['on_demand', 'scheduled'] as const
export type GoalRecommendationSource = typeof GOAL_RECOMMENDATION_SOURCES[number]

export const GOAL_RECOMMENDATION_STATUSES = ['pending', 'applied', 'dismissed'] as const
export type GoalRecommendationStatus = typeof GOAL_RECOMMENDATION_STATUSES[number]

export interface GoalRecommendation {
  id: string
  userId: string
  createdAt: Date
  source: GoalRecommendationSource
  recommendedStepsGoal?: number
  recommendedCalories?: number
  recommendedProteinG?: number
  recommendedCarbsG?: number
  recommendedFatG?: number
  recommendedWaterMl?: number
  recommendedActivityLevel?: ActivityLevel | null
  reasoning?: string
  insights?: string
  dataQualityNote?: string
  status: GoalRecommendationStatus
  appliedAt?: Date
  dismissedAt?: Date
}

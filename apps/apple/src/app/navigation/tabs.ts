export const tabs = ['Home', 'Health', 'Workout', 'Nutrition', 'More'] as const;
export type Tab = (typeof tabs)[number];
export type DetailScreen =
  | 'health-data'
  | 'settings'
  | 'workout-session'
  | 'workout-log'
  | 'programs'
  | 'program-builder'
  | 'exercise-library'
  | 'workout-history'
  | 'strength-progress'
  | 'clinical'
  | 'health-day'
  | 'health-week'
  | 'running'
  | 'guided-walk'
  | 'fitness-baselines'
  | 'friend-profile'
  | 'cardio'
  | 'activity-recording'
  | 'profile-goals';
export type MoreDetail = 'more-data' | 'more-about' | 'year-review';

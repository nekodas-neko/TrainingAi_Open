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
  | 'profile-goals';

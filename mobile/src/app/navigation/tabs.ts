export const tabs = ['Home', 'Health', 'Workout', 'Nutrition', 'More'] as const;
export type Tab = (typeof tabs)[number];
export type DetailScreen =
  | 'coach'
  | 'health-data'
  | 'settings'
  | 'session-explain'
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
  | 'profile-details'
  | 'profile-goals';
export type MoreDetail =
  | 'more-data'
  | 'more-about'
  | 'more-devices'
  | 'more-signed-in-devices'
  | 'more-account'
  | 'more-admin'
  | 'year-review'
  | 'collection';

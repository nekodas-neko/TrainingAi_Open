export const tabs = ['Home', 'Health', 'Workout', 'Nutrition', 'More'] as const;
export type Tab = typeof tabs[number];
export type DetailScreen = 'health-data' | 'settings';

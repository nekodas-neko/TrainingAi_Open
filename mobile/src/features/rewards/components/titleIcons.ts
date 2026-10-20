import type { IconName } from '../../../shared/ui';

// friends.ts TITLES, glyph for glyph. A title the app does not list shows the trophy.
export const titleIcons: Record<string, IconName> = {
  iron_will: 'swords',
  unbroken: 'shieldPlain',
  powerhouse: 'rocket',
  iron_beast: 'workout',
  the_veteran: 'crown',
  century_club: 'trophy',
  set_machine: 'power',
  pr_machine: 'diamond',
  dawn_warrior: 'sunrise',
  ghost: 'moon',
  macro_master: 'circleCheck',
  well_rested: 'bed',
  relentless: 'calendarCheck',
  road_runner: 'activity',
  ultramarathon: 'activity',
  built_different: 'star',
};
export const titleIcon = (id: string): IconName => titleIcons[id] ?? 'trophy';

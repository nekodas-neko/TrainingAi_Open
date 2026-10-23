import type { IconName } from '../../../shared/ui/Icon';
// The current app's friend feed and leaderboard icons (`components/more/friend-feed.tsx`,
// `friend-leaderboard.tsx`): a trend arrow for a PR, a trophy for anything else, a medal for first.
export function feedIconName(type: string): IconName {
  return type === 'pr' ? 'upper' : 'trophy';
}
export const leaderIconName: IconName = 'medal';

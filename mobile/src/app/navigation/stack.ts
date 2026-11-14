import type { CoachScope } from '../../features/coach/data/models';
import type { HealthDetail } from '../../features/health/screens/HealthDetailScreen';
import type { DetailScreen, MoreDetail, Tab } from './tabs';

/**
 * The app's back stack (#3754): a tab, and the screens opened over it, oldest first. Opening a
 * screen pushes, Back pops, choosing a tab clears. No React here, so the rules are tested alone.
 */
type Plain = Exclude<
  DetailScreen | MoreDetail,
  | 'coach'
  | 'workout-session'
  | 'session-explain'
  | 'workout-log'
  | 'health-day'
  | 'health-week'
  | 'friend-profile'
  | 'more-devices'
>;
export type Route =
  | { screen: Plain }
  | { screen: 'coach'; scope: CoachScope }
  | { screen: 'workout-session'; sessionId: string; fullOverride: boolean }
  | { screen: 'session-explain'; sessionId: string }
  | { screen: 'workout-log'; workoutId: string }
  | { screen: 'health-day'; date: string }
  | { screen: 'health-week'; week: string }
  | { screen: 'friend-profile'; friendId: string }
  | { screen: 'health-detail'; detail: HealthDetail }
  /** `ouraReturn` is the link that cold-started the app, for the Oura screen to finish. */
  | { screen: 'more-devices'; ouraReturn?: string };
/** `key` names one visit to a screen, so a covered screen keeps its state until it is popped. */
export type Entry = Route & { key: number };
export type Navigation = { tab: Tab; stack: Entry[]; nextKey: number };

/** The deepest real path is about 4 (Home, session, Coach, Programs, builder). */
export const MAX_DEPTH = 8;

export const initialNavigation: Navigation = { tab: 'Home', stack: [], nextKey: 1 };

export function top(nav: Navigation): Entry | null {
  return nav.stack[nav.stack.length - 1] ?? null;
}

function sameRoute(entry: Entry, route: Route) {
  const { key: _key, ...rest } = entry;
  const a = rest as Record<string, unknown>;
  const b = route as Record<string, unknown>;
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].every((name) => a[name] === b[name]);
}

/**
 * Opens a screen over the current one. A screen already on the stack is returned to, not opened
 * twice, so a loop of screens cannot grow the stack. Past MAX_DEPTH the oldest entry is dropped:
 * Back still walks the newest screens and then lands on the tab.
 */
export function push(nav: Navigation, route: Route): Navigation {
  const at = nav.stack.findIndex((entry) => sameRoute(entry, route));
  if (at >= 0) {
    return at === nav.stack.length - 1 ? nav : { ...nav, stack: nav.stack.slice(0, at + 1) };
  }
  const stack = [...nav.stack, { ...route, key: nav.nextKey }];
  return { ...nav, stack: stack.slice(-MAX_DEPTH), nextKey: nav.nextKey + 1 };
}

/** Back: closes the top screen. With nothing open it changes nothing. */
export function pop(nav: Navigation): Navigation {
  return nav.stack.length ? { ...nav, stack: nav.stack.slice(0, -1) } : nav;
}

/**
 * Swaps the top screen for another. Used where the screen being left is finished and Back should
 * skip it: starting a workout from its session.
 */
export function replaceTop(nav: Navigation, route: Route): Navigation {
  return push(pop(nav), route);
}

/** Choosing a tab closes everything open. */
export function selectTab(nav: Navigation, tab: Tab): Navigation {
  return { ...nav, tab, stack: [] };
}

/** A notification, a widget or a return link: that tab, with one screen open over it. */
export function openOnTab(nav: Navigation, tab: Tab, route: Route): Navigation {
  return push(selectTab(nav, tab), route);
}

/**
 * Android's hardware Back at app level. A screen that is open handles Back itself (its layout
 * registers `onBack`), so the app only acts with nothing open: any tab but Home goes Home, and
 * Home leaves the app.
 */
export function rootBack(nav: Navigation): 'screen' | 'home' | 'exit' {
  if (nav.stack.length) return 'screen';
  return nav.tab === 'Home' ? 'exit' : 'home';
}

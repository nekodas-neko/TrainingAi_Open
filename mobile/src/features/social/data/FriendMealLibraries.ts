import { z } from 'zod';
import { reportError } from '../../../core/reporting/index.ts';
import { ApiError } from '../../account/api/client.ts';
import type { AccountConnection } from '../../account/session.ts';
import type { WorkoutResources } from '../../workouts/data/WorkoutResources.ts';
import { friendMealsSchema, type FriendMeal } from './friend-meals.ts';

export type FriendMealsState = {
  /** The last list the server gave. Kept while a refresh runs, and when one fails for any reason but a 404. */
  meals: FriendMeal[] | null;
  /**
   * The server answered 404. By design that one answer covers "not your friend", "not accepted yet"
   * and "has not turned sharing on", so the screen says nothing more specific.
   */
  unavailable: boolean;
  loading: boolean;
  /** The last request failed for a reason other than a 404. */
  error: string | null;
};
export const idleFriendMeals: FriendMealsState = {
  meals: null,
  unavailable: false,
  loading: false,
  error: null,
};

/**
 * Friends' meal libraries (#2218), read-only and held in memory for the session. Nothing here is
 * written to the phone: it is someone else's data, offered for a moment so it can be copied, and it
 * must not outlive the friendship on disk. What a copy writes lands in the viewer's own nutrition
 * store, which is where the offline-first guarantee lives.
 *
 * Its own small store instead of the saved-view cache because the route's one meaningful failure is
 * a 404 (sharing is off), and a cached list must not stay offered after the friend turns sharing
 * off. A 404 clears the list; any other failure keeps the last list, so a copy still works offline.
 */
export class FriendMealLibraries {
  private states = new Map<string, FriendMealsState>();
  private fetchedAt = new Map<string, number>();
  private requests = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();
  constructor(
    private connection: Pick<AccountConnection, 'get'>,
    private now: () => number = Date.now,
    private ttl = 60_000,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** The same object until something changes, so a React subscription does not re-render for nothing. */
  state(friendshipId: string): FriendMealsState {
    return this.states.get(friendshipId) ?? idleFriendMeals;
  }
  private set(friendshipId: string, patch: Partial<FriendMealsState>) {
    this.states.set(friendshipId, { ...this.state(friendshipId), ...patch });
    this.listeners.forEach((listener) => listener());
  }
  load(friendshipId: string, manual = false): Promise<void> {
    const id = z.uuid().safeParse(friendshipId);
    if (!id.success) {
      return Promise.resolve();
    }
    const key = id.data;
    const active = this.requests.get(key);
    if (active) {
      return active;
    }
    const last = this.fetchedAt.get(key);
    if (!manual && last !== undefined && this.now() - last < this.ttl) {
      return Promise.resolve();
    }
    const work = (async () => {
      this.set(key, { loading: true });
      try {
        const body = friendMealsSchema.parse(
          await this.connection.get(`/api/friends/${key}/saved-meals`),
        );
        this.fetchedAt.set(key, this.now());
        this.set(key, { meals: body.meals, unavailable: false, loading: false, error: null });
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) {
          this.fetchedAt.set(key, this.now());
          this.set(key, { meals: null, unavailable: true, loading: false, error: null });
          return;
        }
        if (!(cause instanceof ApiError) || cause.status >= 500) {
          reportError(cause, { apiPath: '/api/friends/[id]/saved-meals' });
        }
        this.set(key, { loading: false, error: loadFailure(cause) });
      }
    })().finally(() => this.requests.delete(key));
    this.requests.set(key, work);
    return work;
  }
  /** After a friendship ends: nothing of theirs stays offered. */
  forget(friendshipId: string) {
    this.states.delete(friendshipId);
    this.fetchedAt.delete(friendshipId);
    this.listeners.forEach((listener) => listener());
  }
}

function loadFailure(cause: unknown) {
  if (cause instanceof ApiError && cause.status === 429) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
    return 'Check your sign-in and account access to load these meals.';
  }
  if (cause instanceof z.ZodError) {
    return 'The server returned a list that could not be read.';
  }
  return 'Could not load these meals. Check your connection and retry.';
}

const libraries = new WeakMap<WorkoutResources, FriendMealLibraries>();
/** The one set of friend libraries for an account's connection: its resources object lives as long as the sign-in. */
export function friendMealLibraries(resources: WorkoutResources) {
  let found = libraries.get(resources);
  if (!found) {
    found = new FriendMealLibraries(resources.connection);
    libraries.set(resources, found);
  }
  return found;
}

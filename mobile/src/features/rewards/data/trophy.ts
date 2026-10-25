import { z } from 'zod';
import { TROPHY_SLOTS } from '@trainingai/shared/achievement-display';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import type { WorkoutResources } from '../../workouts/data/WorkoutResources.ts';

const key = 'trophy-case.v1';
const ids = z.array(z.string());

/**
 * The pins this phone saved before they lived on the account. Kept only so they can be carried over
 * once (see `carryOverTrophyCase`); nothing writes this list any more.
 */
export async function readTrophyCase(storage: ScopedStorage) {
  try {
    const raw = await storage.get(key);
    return raw ? ids.parse(JSON.parse(raw)).slice(-TROPHY_SLOTS) : [];
  } catch {
    return [];
  }
}

export async function writeTrophyCase(storage: ScopedStorage, pinned: readonly string[]) {
  await storage.set(key, JSON.stringify(pinned.slice(-TROPHY_SLOTS)));
}

/** `GET /api/user/trophy-pins`: the pins saved on the account, in pin order; null when none. */
export const trophyPinsSpec = {
  path: '/api/user/trophy-pins',
  schema: z.object({ pins: z.array(z.string()).nullable() }),
  ttl: 300000,
};

/**
 * Save the pins on the account, which is what friends see, and show them at once. Resolves false when
 * the server refuses or cannot be reached; the view then goes back to what it showed before.
 */
export async function saveTrophyPins(
  resources: Pick<WorkoutResources, 'write' | 'state' | 'replace'>,
  pins: readonly string[],
) {
  const before = resources.state(trophyPinsSpec).data;
  const kept = pins.slice(0, TROPHY_SLOTS);
  const show = (value: string[]) =>
    resources.replace(trophyPinsSpec, { pins: value.length > 0 ? value : null }).catch(() => {});
  await show(kept);
  try {
    await resources.write('PUT', trophyPinsSpec.path, { pins: kept }, ['/api/profile']);
  } catch {
    await show(before?.pins ?? []);
    return false;
  }
  return true;
}

/**
 * Move the pins this phone kept before the account held them onto the account, once. Run it after
 * the account's own pins have been read: an account that already has pins keeps them, and the old
 * list is dropped either way so it can never overwrite a later change. If the save fails the old
 * list stays, and the next load tries again.
 */
export async function carryOverTrophyCase(
  resources: Pick<WorkoutResources, 'write' | 'state' | 'replace'>,
  storage: ScopedStorage,
) {
  const account = resources.state(trophyPinsSpec).data;
  if (!account) return;
  const old = await readTrophyCase(storage);
  if (old.length > 0 && account.pins === null && !(await saveTrophyPins(resources, old))) return;
  await storage.remove(key).catch(() => {});
}

// The pins read this session, per account, so a screen that mounts again paints them at once
// instead of three empty slots until the phone has answered.
const known = new Map<string, string[]>();
export const trophyCacheKey = (origin: string, userId: string) =>
  JSON.stringify([origin, userId]);
export const cachedTrophyCase = (key: string) => known.get(key);
export function rememberTrophyCase(key: string, pinned: readonly string[]) {
  known.set(key, pinned.slice(-TROPHY_SLOTS));
}

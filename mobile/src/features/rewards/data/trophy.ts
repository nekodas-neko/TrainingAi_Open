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

export type PinsSave = 'saved' | 'refused' | 'failed';

/**
 * The account's pins read from the server now, bypassing what this phone saved: `null` when the read
 * failed (nothing is known), otherwise the account's value, `pins: null` meaning it has none. The
 * saved copy can be older than a change made on another device, so the carry-over waits for this.
 */
export async function readFreshTrophyPins(connection: {
  get(path: string): Promise<unknown>;
}): Promise<{ pins: string[] | null } | null> {
  try {
    return trophyPinsSpec.schema.parse(await connection.get(trophyPinsSpec.path));
  } catch {
    return null;
  }
}

/** The server saying no to this list (400 malformed, 403 a trophy not unlocked): retrying cannot help. */
const refused = (error: unknown) => {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 400 || status === 403;
};

/**
 * Save the pins on the account, which is what friends see, and show them at once. 'refused' is the
 * server rejecting the list itself; 'failed' is anything that could clear (offline, a 5xx). On either
 * the view goes back to what it showed before. While the account's pins are unknown (nothing read
 * yet, or the read failed) nothing is saved: the list handed in could be an empty guess, and saving
 * replaces the whole list.
 */
export async function saveTrophyPins(
  resources: Pick<WorkoutResources, 'write' | 'state' | 'replace'>,
  pins: readonly string[],
): Promise<PinsSave> {
  const before = resources.state(trophyPinsSpec).data;
  if (!before) return 'failed';
  const kept = pins.slice(0, TROPHY_SLOTS);
  const show = (value: string[]) =>
    resources.replace(trophyPinsSpec, { pins: value.length > 0 ? value : null }).catch(() => {});
  await show(kept);
  try {
    await resources.write('PUT', trophyPinsSpec.path, { pins: kept }, ['/api/profile']);
  } catch (error) {
    await show(before.pins ?? []);
    return refused(error) ? 'refused' : 'failed';
  }
  return 'saved';
}

/**
 * Move the pins this phone kept before the account held them onto the account, once. `account` is
 * the account's pins as the server just returned them (`readFreshTrophyPins`), never the saved copy,
 * and `null` (the read failed) decides nothing. An account that already has pins keeps them, and the
 * old list is dropped either way so it can never overwrite a later change.
 *
 * The old list is cut to the trophies unlocked now. The server refuses a whole list if any id is
 * locked or unknown, so a kept list holding one would be retried on every load for ever. A refusal
 * drops it too; only a failure that could clear (offline, a 5xx) keeps it for the next load. With
 * nothing known to be unlocked yet, it waits.
 */
export async function carryOverTrophyCase(
  resources: Pick<WorkoutResources, 'write' | 'state' | 'replace'>,
  storage: ScopedStorage,
  unlockedIds: ReadonlySet<string>,
  account: { pins: string[] | null } | null,
) {
  if (!account || unlockedIds.size === 0) return;
  const old = await readTrophyCase(storage);
  const usable = old.filter((id) => unlockedIds.has(id));
  if (usable.length > 0 && account.pins === null) {
    if ((await saveTrophyPins(resources, usable)) === 'failed') return;
  }
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

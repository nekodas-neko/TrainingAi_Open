import { z } from 'zod';
import { TROPHY_SLOTS } from '@trainingai/shared/achievement-display';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';

const key = 'trophy-case.v1';
const ids = z.array(z.string());

/**
 * The achievements pinned in this account's trophy case on this phone. The current app keeps the
 * same list in the device's own storage, so it is a choice made per device, not an account value.
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

// The pins read this session, per account, so a screen that mounts again paints them at once
// instead of three empty slots until the phone has answered.
const known = new Map<string, string[]>();
export const trophyCacheKey = (origin: string, userId: string) =>
  JSON.stringify([origin, userId]);
export const cachedTrophyCase = (key: string) => known.get(key);
export function rememberTrophyCase(key: string, pinned: readonly string[]) {
  known.set(key, pinned.slice(-TROPHY_SLOTS));
}

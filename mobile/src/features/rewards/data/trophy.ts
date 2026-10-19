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
    return raw ? ids.parse(JSON.parse(raw)).slice(0, TROPHY_SLOTS) : [];
  } catch {
    return [];
  }
}

export async function writeTrophyCase(storage: ScopedStorage, pinned: readonly string[]) {
  await storage.set(key, JSON.stringify(pinned.slice(0, TROPHY_SLOTS)));
}

import { z } from "zod";
import type { ScopedStorage } from "../../../core/storage/LocalStorage.ts";

const key = "seen-achievements.v1";
const ids = z.array(z.string());

/** Achievement ids this account has already been shown as unlocked. */
export async function readSeen(storage: ScopedStorage) {
  try {
    const raw = await storage.get(key);
    return raw ? ids.parse(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export async function markSeen(
  storage: ScopedStorage,
  seen: readonly string[],
  more: string[],
) {
  const next = [...new Set([...seen, ...more])];
  await storage.set(key, JSON.stringify(next));
  return next;
}

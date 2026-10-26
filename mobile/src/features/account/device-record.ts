/**
 * #3369 — which account the data on this phone belongs to, and the admin reset it has wiped for.
 *
 * Preview keeps each account's data in its own scope of the local database, keyed by (backend, user
 * id), and sign-out leaves it there. Two things follow, and this record settles both:
 *
 * - **Admin reset.** The server empties the account and refuses every earlier sign-in, but the
 *   phone still holds the old rows and, above all, its queued writes (`HistoryOutbox`, the journal,
 *   the strap and scale outboxes, the Health Connect queue). They are scoped to the same user id, so
 *   they would flush the moment the person signs in again. The server reports the reset moment
 *   (`GET /api/account/data-epoch`, whole seconds, 0 when never); a phone whose record is older wipes
 *   that account's scope before the account's stores are opened.
 * - **A different account.** An admin deletes an account and the person signs up again with a new
 *   user id: the old scope is an orphan holding their data, which nothing would ever remove. Signing
 *   in as anyone but the recorded owner wipes every account scope on the phone first.
 *
 * Every write then carries the epoch in `X-Data-Epoch` (`epochHeader`), and the server refuses a
 * write from a phone that has not reached it (409), which is the guard for the queued writes of a
 * phone whose record was lost.
 *
 * Pure of the platform: reads, writes and the wipe come in through `deps`.
 */
export const DEVICE_RECORD_KEY = 'fitnessai.device.v1';

export type DeviceRecord = { origin: string; userId: string; epoch: number };

export function parseDeviceRecord(raw: string | null): DeviceRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DeviceRecord> | null;
    return value &&
      typeof value.origin === 'string' &&
      typeof value.userId === 'string' &&
      value.userId.length > 0 &&
      Number.isSafeInteger(value.epoch) &&
      value.epoch! >= 0
      ? { origin: value.origin, userId: value.userId, epoch: value.epoch! }
      : null;
  } catch {
    return null;
  }
}

/** The `X-Data-Epoch` value for this account on this backend, or null when the phone claims none. */
export function epochHeader(
  record: DeviceRecord | null,
  origin: string,
  userId: string | null,
): string | null {
  return record && userId && record.origin === origin && record.userId === userId
    ? `${userId}:${record.epoch}`
    : null;
}

export type DeviceDeps = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  /** A user id wipes that account's scope; null wipes every account scope on the phone. */
  wipe(origin: string, userId: string | null): Promise<void>;
};

export type DeviceReconcile = {
  outcome: 'ok' | 'wiped';
  record: DeviceRecord;
};

/**
 * Settle this phone against the server's epoch for the account that is signing in. Wipes first and
 * records after, so a failure in between leaves the old record and the next attempt wipes again.
 * Throws if the wipe or the record cannot be written; the caller does not open the account then.
 */
export async function reconcileDevice(
  deps: DeviceDeps,
  origin: string,
  userId: string,
  serverEpoch: number,
): Promise<DeviceReconcile> {
  const record = parseDeviceRecord(await deps.read());
  const sameOwner = record !== null && record.origin === origin && record.userId === userId;
  if (sameOwner && record.epoch >= serverEpoch) {
    return { outcome: 'ok', record };
  }
  let wiped = false;
  if (record !== null && !sameOwner) {
    // Someone else's data is on this phone: all of it goes, orphans of older accounts included.
    await deps.wipe(origin, null);
    wiped = true;
  } else if (sameOwner || serverEpoch > 0) {
    // Behind a reset (or a phone with no record that meets one): this account's scope goes.
    await deps.wipe(origin, userId);
    wiped = true;
  }
  const next: DeviceRecord = { origin, userId, epoch: serverEpoch };
  await deps.write(JSON.stringify(next));
  return { outcome: wiped ? 'wiped' : 'ok', record: next };
}

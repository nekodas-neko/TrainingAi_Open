import { z } from 'zod';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import type { AccountConnection } from '../../account/session.ts';
import { ApiError, isValidationRejection } from '../../account/api/client.ts';

// A weigh-in is saved on the phone first, then sent to `/api/scale-ble/samples`, the route the
// current app's scale service posts to. The server bands it against the account's last confirmed
// weight and computes body composition; this only carries what the scale said and reports the
// verdict. Unlike the service, each reading carries the moment it was captured, so one sent after a
// signal outage is filed on the day it was taken rather than the day it got through.
const key = 'scale-outbox.v1';
export const MAX_SAVED_READINGS = 50;

const reading = z.object({
  rawHex: z.string(),
  weightKg: z.number(),
  impedanceOhmsA: z.number().int(),
  impedanceOhmsB: z.number().int(),
  measuredAt: z.string(),
});
export type ScaleReading = z.infer<typeof reading>;
const saved = z.object({
  version: z.literal(1),
  origin: z.string(),
  userId: z.string(),
  readings: z.array(reading),
});

/** The route's answer. Fields beyond `status` are read leniently: an older deploy omits some. */
const verdictSchema = z.object({
  status: z.enum(['confirmed', 'pending', 'dismissed']),
  weightKg: z.number().optional(),
  compositionSkipped: z.boolean().optional(),
  compositionSkippedReason: z.enum(['impedance', 'profile']).nullable().optional(),
  isAdditionalReadingForDay: z.boolean().optional(),
});
export type ScaleVerdict = z.infer<typeof verdictSchema>;

/** What happened to one saved reading when it was sent. */
export type ScaleOutcome =
  | { kind: 'verdict'; reading: ScaleReading; verdict: ScaleVerdict }
  /** The server refused it for good (a malformed or out-of-range frame); it was dropped. */
  | { kind: 'rejected'; reading: ScaleReading };

export class ScaleOutbox {
  private readings: ScaleReading[] = [];
  private loaded: Promise<void> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private uploading: Promise<void> | null = null;
  constructor(
    private storage: ScopedStorage,
    private connection: Pick<AccountConnection, 'origin' | 'userId' | 'post'>,
    private onOutcome: (outcome: ScaleOutcome) => void = () => {},
  ) {}

  private load() {
    return (this.loaded ??= (async () => {
      const raw = await this.storage.get(key).catch(() => null);
      const parsed = raw ? saved.safeParse(JSON.parse(raw)) : null;
      // Another account's weigh-ins are never filed as this one's.
      if (
        parsed?.success &&
        parsed.data.origin === this.connection.origin &&
        parsed.data.userId === this.connection.userId
      )
        this.readings = [...parsed.data.readings, ...this.readings];
    })().catch(() => {}));
  }

  private save() {
    const result = this.writes.then(() =>
      this.storage.set(
        key,
        JSON.stringify({
          version: 1,
          origin: this.connection.origin,
          userId: this.connection.userId,
          readings: this.readings,
        }),
      ),
    );
    this.writes = result.catch(() => undefined);
    return result;
  }

  /** Which account this outbox files for. */
  get account() {
    return JSON.stringify([this.connection.origin, this.connection.userId]);
  }

  pending() {
    return this.readings.length;
  }

  /** Saves the reading on the phone. Resolves once it is written. */
  async append(next: ScaleReading) {
    await this.load();
    this.readings.push(next);
    if (this.readings.length > MAX_SAVED_READINGS)
      this.readings.splice(0, this.readings.length - MAX_SAVED_READINGS);
    await this.save();
  }

  /** Sends everything saved, oldest first. Stops at the first network failure and keeps the rest. */
  sync(): Promise<void> {
    return (this.uploading ??= this.upload().finally(() => {
      this.uploading = null;
    }));
  }

  private async upload() {
    await this.load();
    while (this.readings.length) {
      const next = this.readings[0];
      let outcome: ScaleOutcome;
      try {
        const body = await this.connection.post('/api/scale-ble/samples', next);
        const verdict = verdictSchema.safeParse(body);
        // A 200 we cannot read was still filed; asking again would only file it twice.
        outcome = verdict.success
          ? { kind: 'verdict', reading: next, verdict: verdict.data }
          : { kind: 'rejected', reading: next };
      } catch (error) {
        // A 400 or 413 would fail the same way forever; dropping it keeps the queue moving.
        if (isValidationRejection(error) || (error instanceof ApiError && error.status === 413))
          outcome = { kind: 'rejected', reading: next };
        else break;
      }
      this.readings = this.readings.filter((x) => x !== next);
      await this.save().catch(() => {});
      this.onOutcome(outcome);
    }
  }
}

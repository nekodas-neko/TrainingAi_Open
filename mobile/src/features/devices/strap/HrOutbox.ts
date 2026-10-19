import { z } from 'zod';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import type { AccountConnection } from '../../account/session.ts';
import { ApiError } from '../../account/api/client.ts';

// Strap samples are saved on the phone first, then sent to `/api/hr-ingest`, the route the current
// app's strap service posts to. The server stores them in `oura_heartrate` as `chest_strap` and
// `rr_intervals`, so the workout recap and per-set HR compute exactly as they do today.
const key = 'strap-hr-outbox.v1';
/** Four hours at 1 Hz. A longer outage drops the oldest samples first. */
export const MAX_SAVED_SAMPLES = 14_400;
/** Well under the route's 2,000-sample and 512 KB limits. */
export const UPLOAD_BATCH = 500;

const sample = z.object({
  at: z.number().int().nonnegative(),
  bpm: z.number().int(),
  rr: z.array(z.number().int()).max(100),
});
export type StrapSample = z.infer<typeof sample>;
const saved = z.object({
  version: z.literal(1),
  origin: z.string(),
  userId: z.string(),
  samples: z.array(sample),
});

export class HrOutbox {
  private samples: StrapSample[] = [];
  private loaded: Promise<void> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private uploading: Promise<void> | null = null;
  constructor(
    private storage: ScopedStorage,
    private connection: Pick<AccountConnection, 'origin' | 'userId' | 'post'>,
    private onUploaded: () => void = () => {},
  ) {}

  private load() {
    return (this.loaded ??= (async () => {
      const raw = await this.storage.get(key).catch(() => null);
      const parsed = raw ? saved.safeParse(JSON.parse(raw)) : null;
      // Another account's samples are never uploaded as this one's.
      if (
        parsed?.success &&
        parsed.data.origin === this.connection.origin &&
        parsed.data.userId === this.connection.userId
      )
        this.samples = [...parsed.data.samples, ...this.samples];
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
          samples: this.samples,
        }),
      ),
    );
    this.writes = result.catch(() => undefined);
    return result;
  }

  /** Which account this outbox saves for. */
  get account() {
    return JSON.stringify([this.connection.origin, this.connection.userId]);
  }

  pending() {
    return this.samples.length;
  }

  /** Saves the samples on the phone. Resolves once they are written. */
  async append(samples: StrapSample[]) {
    if (!samples.length) return;
    await this.load();
    this.samples.push(...samples);
    if (this.samples.length > MAX_SAVED_SAMPLES)
      this.samples.splice(0, this.samples.length - MAX_SAVED_SAMPLES);
    await this.save();
  }

  /** Uploads everything saved, oldest first. Stops at the first failure and keeps the rest. */
  sync(): Promise<void> {
    return (this.uploading ??= this.upload().finally(() => {
      this.uploading = null;
    }));
  }

  private async upload() {
    await this.load();
    let sent = false;
    while (this.samples.length) {
      const batch = this.samples.slice(0, UPLOAD_BATCH);
      let drop = true;
      try {
        await this.connection.post('/api/hr-ingest', { samples: batch });
        sent = true;
      } catch (error) {
        // A 400 or 413 would fail the same way forever; dropping it keeps the queue moving. The
        // route already filters implausible values per sample, so this is a malformed batch.
        drop = error instanceof ApiError && (error.status === 400 || error.status === 413);
        if (!drop) break;
      } finally {
        if (drop) {
          // By identity: an append during the upload may have trimmed the head already.
          const done = new Set(batch);
          this.samples = this.samples.filter((x) => !done.has(x));
          await this.save().catch(() => {});
        }
      }
    }
    if (sent) this.onUploaded();
  }
}

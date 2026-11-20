/**
 * #3913: Sync now waits on every store at once. Each request is cut off at 15 s, but a store that
 * awaits several in turn could still hold the button busy for minutes. Past this, it says so and
 * stops waiting; the uploads carry on behind it and keep their own retries.
 */
export const SYNC_NOW_LIMIT_MS = 45_000;
export const SYNC_NOW_SLOW =
  'Sync is taking longer than usual. It carries on in the background, and your changes stay saved on this phone.';

/** `work`, or a rejection with `message` once `ms` pass first. `work` itself is not stopped. */
export function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

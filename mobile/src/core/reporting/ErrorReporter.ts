import {
  MAX_CLIENT_ERROR_BATCH,
  NativeClientErrorSchema,
  type NativeClientError,
} from '@trainingai/shared/validation/client-error';
import { isExpectedFailure, reportMessage, scrubApiPath, scrubScreen } from './scrub.ts';

export type ReportContext = { screen?: string; apiPath?: string };
export type BuildInfo = Pick<NativeClientError, 'appVersion' | 'buildCode' | 'platform'>;
type Send = (path: '/api/client-error', body: { events: NativeClientError[] }) => Promise<unknown>;

const QUEUE_LIMIT = 10;
const FIRST_SEND_MS = 5_000;
// The intake allows 10 requests a minute per account; one every 10 s stays well inside it.
const SEND_GAP_MS = 10_000;
const REPEAT_WINDOW_MS = 10 * 60_000;
const HOURLY_LIMIT = 30;

/**
 * Sends unexpected errors from release builds to `/api/client-error` (#2913). It is off until
 * `enable` runs, never throws, never waits on the network for its caller, and drops what it cannot
 * send rather than retrying: a report is a hint, and the queue must stay small.
 */
export class ErrorReporter {
  private build: BuildInfo | null = null;
  private send: Send | null = null;
  private account: string | null = null;
  private screen = 'App';
  private queue: NativeClientError[] = [];
  private seen = new Map<string, number>();
  private accepted: number[] = [];
  private reported = new WeakSet<object>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSend = -Infinity;

  constructor(
    private now: () => number = Date.now,
    private schedule: (run: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
  ) {}

  enable(build: BuildInfo) {
    this.build = build;
  }
  /**
   * The signed-in account and its poster, or nulls when signed out. A report is only ever sent as
   * the account it happened under: a change of account clears the queue, and while signed out
   * nothing is queued.
   */
  connect(account: string | null, send: Send | null) {
    if (account !== this.account) {
      this.queue = [];
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    }
    this.account = send ? account : null;
    this.send = this.account ? send : null;
    this.arm();
  }
  setScreen(name: string) {
    this.screen = scrubScreen(name);
  }

  report(error: unknown, context: ReportContext = {}): void {
    try {
      if (!this.build || !this.account || isExpectedFailure(error)) return;
      if (typeof error === 'object' && error !== null) {
        if (this.reported.has(error)) return;
        this.reported.add(error);
      }
      const event = NativeClientErrorSchema.safeParse({
        message: reportMessage(error),
        screen: context.screen ? scrubScreen(context.screen) : this.screen,
        apiPath: scrubApiPath((error as { path?: string } | null)?.path ?? context.apiPath),
        ...this.build,
      });
      if (!event.success) return;
      const now = this.now();
      const fingerprint = `${event.data.message}|${event.data.screen}|${event.data.apiPath ?? ''}`;
      const last = this.seen.get(fingerprint);
      if (last !== undefined && now - last < REPEAT_WINDOW_MS) return;
      this.accepted = this.accepted.filter((at) => now - at < 60 * 60_000);
      if (this.accepted.length >= HOURLY_LIMIT || this.queue.length >= QUEUE_LIMIT) return;
      this.seen.set(fingerprint, now);
      if (this.seen.size > 100) this.seen.delete(this.seen.keys().next().value!);
      this.accepted.push(now);
      this.queue.push(event.data);
      this.arm();
    } catch {
      // Reporting must never become the failure.
    }
  }

  /** Send what is queued now, for a fatal error that is about to end the app. Never rejects. */
  async flushNow(timeoutMs: number): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    await Promise.race([
      this.flush(),
      new Promise<void>((resolve) => this.schedule(resolve, timeoutMs)),
    ]).catch(() => {});
  }

  private arm() {
    if (this.timer !== null || !this.send || this.queue.length === 0) return;
    const wait = Math.max(FIRST_SEND_MS, this.lastSend + SEND_GAP_MS - this.now());
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  private async flush() {
    const send = this.send;
    if (!send || !this.account || this.queue.length === 0) return;
    const events = this.queue.splice(0, MAX_CLIENT_ERROR_BATCH);
    this.lastSend = this.now();
    try {
      await send('/api/client-error', { events });
    } catch {
      // Offline or refused: these are dropped, not retried.
    }
    this.arm();
  }
}

export type StartupMark = 'start' | 'home' | 'workout' | 'health';
export type StartupBuild = { platform: 'android' | 'ios'; appVersion: string; buildCode: string };
/** One row of the server's `app_load_metrics`, in the shape `POST /api/app-load` accepts. */
export type StartupRow = {
  route: string;
  responseStartMs: number | null;
  totalMs: number;
  cold: boolean;
  buildId: string;
};
type Send = (path: '/api/app-load', body: StartupRow) => Promise<unknown>;

const MARKS: StartupMark[] = ['start', 'home', 'workout', 'health'];
// A mark this late is not start-up any more, and the report waits no longer for the rest.
export const STARTUP_DEADLINE_MS = 120_000;
// The intake's own bound, so a row is never dropped by its schema.
const MAX_MS = 600_000;

/** React Native's start-up markers, all on one native clock: the part before the bundle ran. */
export function nativeStartMs(timing: {
  startTime?: number;
  executeJavaScriptBundleEntryPointStart?: number;
} | null | undefined): number | null {
  const start = timing?.startTime;
  const bundle = timing?.executeJavaScriptBundleEntryPointStart;
  if (typeof start !== 'number' || typeof bundle !== 'number') return null;
  const ms = bundle - start;
  return Number.isFinite(ms) && ms >= 0 && ms < MAX_MS ? Math.round(ms) : null;
}

/**
 * How long this process took to show its first screen and each main tab's first data (#3774), sent
 * once per start to `POST /api/app-load` as at most four rows. Timings and booleans only: no health
 * value, name or free text. A start that went to the background before a mark, or that began in
 * the background (a background task woke the app), reports nothing it had not already measured.
 * Never throws, never retries.
 */
export class StartupTimings {
  private build: StartupBuild | null = null;
  private nativeMs: number | null = null;
  private rows = new Map<StartupMark, StartupRow>();
  private seenReady = new Map<StartupMark, boolean>();
  private stopped = false;
  private sent = false;
  private account: string | null = null;
  private send: Send | null = null;

  constructor(
    private startedAt: number,
    private now: () => number,
    private schedule: (run: () => void, ms: number) => unknown = setTimeout,
  ) {}

  /** Release builds only. `foreground` false means the process did not start for the person. */
  enable(build: StartupBuild, nativeMs: number | null, foreground: boolean) {
    if (this.build) return;
    this.build = build;
    this.nativeMs = nativeMs;
    if (!foreground) this.stopped = true;
    try {
      const left = Math.max(0, this.startedAt + STARTUP_DEADLINE_MS - this.now());
      this.schedule(() => this.stop(), left);
    } catch {}
  }

  connect(account: string | null, send: Send | null) {
    this.account = send ? account : null;
    this.send = this.account ? send : null;
    this.flush();
  }

  /** The app left the screen: what is measured so far goes, and nothing later is counted. */
  stop() {
    this.stopped = true;
    this.flush();
  }

  /** The first time `mark` happens in this process. `cold`: it had to wait for the network. */
  mark(mark: StartupMark, cold: boolean) {
    try {
      if (!this.build || this.stopped || this.rows.has(mark)) return;
      const elapsed = this.now() - this.startedAt;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > STARTUP_DEADLINE_MS) return;
      const total = Math.round(elapsed) + (this.nativeMs ?? 0);
      if (total > MAX_MS) return;
      this.rows.set(mark, {
        route: `/native/${this.build.platform}/${mark}`,
        responseStartMs: this.nativeMs,
        totalMs: total,
        cold,
        buildId: `${this.build.appVersion}+${this.build.buildCode}`.slice(0, 64),
      });
      if (this.rows.size === MARKS.length) this.stopped = true;
      this.flush();
    } catch {}
  }

  /**
   * A tab's data, observed on every change. It counts the first time `hasData` is true, as cold
   * unless the data was already there when the tab's saved copy finished opening (`ready`).
   */
  observe(mark: Exclude<StartupMark, 'start'>, ready: boolean, hasData: boolean) {
    if (ready && !this.seenReady.has(mark)) this.seenReady.set(mark, hasData);
    if (hasData) this.mark(mark, this.seenReady.get(mark) !== true);
  }

  private flush() {
    const send = this.send;
    if (!this.stopped || this.sent || !send || !this.account || this.rows.size === 0) return;
    this.sent = true;
    const rows = MARKS.flatMap((mark) => this.rows.get(mark) ?? []);
    void (async () => {
      for (const row of rows) {
        try {
          await send('/api/app-load', row);
        } catch {
          return;
        }
      }
    })();
  }
}

import { isNetworkFailure } from '../reporting/scrub.ts';

/** The shortest gap between two returns that void backoffs and re-fire the providers. */
export const RECONNECT_MIN_GAP_MS = 60_000;

/**
 * A failure that says the network is down: the request never reached the server. A timeout is not
 * one: a slow or hung route on a working network times out too, and counting it would void every
 * backoff on the next answer from any other route and re-fire it again and again.
 */
export function isConnectionFailure(error: unknown) {
  if (!isNetworkFailure(error)) return false;
  const { name, message } = error as Error;
  return name !== 'TimeoutError' && name !== 'AbortError' && !/timed? ?out/i.test(message);
}

/**
 * #3913. Whether the server can be reached, as the API client last saw it. A request that never got
 * an answer marks it offline; any answer at all (an error status included) marks it online again,
 * and each return bumps `generation` and tells the subscribers, so the screens retry at once
 * instead of waiting out a backoff of up to five minutes. There is no network-state module in the
 * app, so the return is seen by a request: a store's own, or the probe `useConnectivityProbe` sends
 * while offline. Returns closer together than `minGap` are folded into one at the end of the gap,
 * so a flaky link cannot re-fire every provider on each answer.
 */
export class Connectivity {
  private offline = false;
  private count = 0;
  private listeners = new Set<() => void>();
  private lastReturn = -Infinity;
  private deferred: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private now = () => Date.now(),
    private minGap = RECONNECT_MIN_GAP_MS,
  ) {}
  isOffline() {
    return this.offline;
  }
  /** Bumped on every return; a backoff set in an older generation is void. */
  generation() {
    return this.count;
  }
  /** A request failed. Only one that never reached the server says anything about the network. */
  failed(error: unknown) {
    if (isConnectionFailure(error)) this.offline = true;
  }
  /** The server answered. */
  reached() {
    if (!this.offline) return;
    this.offline = false;
    const wait = this.lastReturn + this.minGap - this.now();
    if (wait <= 0) return this.announce();
    if (this.deferred) return;
    this.deferred = setTimeout(() => {
      this.deferred = null;
      // Down again by then: the next answer announces the return instead.
      if (!this.offline) this.announce();
    }, wait);
    (this.deferred as { unref?: () => void }).unref?.();
  }
  private announce() {
    this.lastReturn = this.now();
    this.count++;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // One subscriber's failure must not keep the others from retrying.
      }
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export const connectivity = new Connectivity();

/** How often a phone that last saw no connection asks the server whether it is back. */
export const PROBE_INTERVAL_MS = 10_000;

/**
 * One check for the probe: while `network` says offline, sends `probe` (any request through the
 * API client, which reports the answer itself), never two at once. Online, it sends nothing.
 */
export function probeWhileOffline(network: Connectivity, probe: () => Promise<unknown>) {
  let running = false;
  return () => {
    if (!network.isOffline() || running) return Promise.resolve();
    running = true;
    return probe()
      .catch(() => {})
      .finally(() => {
        running = false;
      });
  };
}

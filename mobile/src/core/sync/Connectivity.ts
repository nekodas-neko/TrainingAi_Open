import { isNetworkFailure } from '../reporting/scrub.ts';

/**
 * #3913. Whether the server can be reached, as the API client last saw it. A request that never got
 * an answer marks it offline; any answer at all (an error status included) marks it online again,
 * and each return bumps `generation` and tells the subscribers, so the screens retry at once
 * instead of waiting out a backoff of up to five minutes. There is no network-state module in the
 * app, so the return is seen by a request: a store's own, or the probe `useConnectivityProbe` sends
 * while offline.
 */
export class Connectivity {
  private offline = false;
  private count = 0;
  private listeners = new Set<() => void>();
  isOffline() {
    return this.offline;
  }
  /** Bumped on every return; a backoff set in an older generation is void. */
  generation() {
    return this.count;
  }
  /** A request failed. Only one that never reached the server says anything about the network. */
  failed(error: unknown) {
    if (isNetworkFailure(error)) this.offline = true;
  }
  /** The server answered. */
  reached() {
    if (!this.offline) return;
    this.offline = false;
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

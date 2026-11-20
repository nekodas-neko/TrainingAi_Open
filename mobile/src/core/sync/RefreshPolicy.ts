import { connectivity, type Connectivity } from './Connectivity.ts';

export class RefreshPolicy {
  private checkedAt: number | null = null;
  private retryAt = 0;
  private failures = 0;
  private failedIn: number;
  // A return voids a backoff once per run of failures: a route that keeps failing while the rest
  // of the app answers goes back to its own backoff instead of re-firing on every return.
  private voided = false;

  constructor(
    private now = Date.now,
    private staleAfter = 5 * 60_000,
    private network: Pick<Connectivity, 'generation'> = connectivity,
  ) {
    this.failedIn = network.generation();
  }

  shouldRefresh() {
    const now = this.now();
    const stale =
      this.checkedAt === null || now < this.checkedAt || now - this.checkedAt >= this.staleAfter;
    if (!stale) return false;
    if (now >= this.retryAt) return true;
    // #3913: a backoff from before the connection came back is void, once.
    if (this.voided || this.network.generation() === this.failedIn) return false;
    this.voided = true;
    return true;
  }

  succeeded(checkedAt = this.now()) {
    this.checkedAt = checkedAt;
    this.retryAt = 0;
    this.failures = 0;
    this.voided = false;
  }

  failed() {
    this.checkedAt = null;
    this.failedIn = this.network.generation();
    this.failures++;
    this.retryAt = this.now() + Math.min(30_000 * 2 ** (this.failures - 1), 5 * 60_000);
  }

  invalidate() {
    this.checkedAt = null;
    this.retryAt = 0;
    this.failures = 0;
    this.voided = false;
  }
}

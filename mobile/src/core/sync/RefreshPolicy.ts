import { connectivity, type Connectivity } from './Connectivity.ts';

export class RefreshPolicy {
  private checkedAt: number | null = null;
  private retryAt = 0;
  private failures = 0;
  private failedIn: number;

  constructor(
    private now = Date.now,
    private staleAfter = 5 * 60_000,
    private network: Pick<Connectivity, 'generation'> = connectivity,
  ) {
    this.failedIn = network.generation();
  }

  shouldRefresh() {
    const now = this.now();
    return (
      // #3913: a backoff from before the connection came back is void.
      (now >= this.retryAt || this.network.generation() !== this.failedIn) &&
      (this.checkedAt === null || now < this.checkedAt || now - this.checkedAt >= this.staleAfter)
    );
  }

  succeeded(checkedAt = this.now()) {
    this.checkedAt = checkedAt;
    this.retryAt = 0;
    this.failures = 0;
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
  }
}

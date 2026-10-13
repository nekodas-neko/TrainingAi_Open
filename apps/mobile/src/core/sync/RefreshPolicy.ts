export class RefreshPolicy {
  private checkedAt: number | null = null;
  private retryAt = 0;
  private failures = 0;

  constructor(
    private now = Date.now,
    private staleAfter = 5 * 60_000,
  ) {}

  shouldRefresh() {
    const now = this.now();
    return (
      now >= this.retryAt &&
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
    this.failures++;
    this.retryAt = this.now() + Math.min(30_000 * 2 ** (this.failures - 1), 5 * 60_000);
  }

  invalidate() {
    this.checkedAt = null;
    this.retryAt = 0;
    this.failures = 0;
  }
}

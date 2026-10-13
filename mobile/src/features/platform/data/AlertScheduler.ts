import { alertSignature, type Alert } from './models.ts';
export type ScheduledAlert = { id: string; signature: string };
export type AlertService = {
  list: () => Promise<ScheduledAlert[]>;
  schedule: (alert: Alert) => Promise<void>;
  cancel: (id: string) => Promise<void>;
};
export class AlertScheduler {
  private wanted: Alert[] = [];
  private revision = 0;
  private running: Promise<void> | null = null;
  constructor(private service: AlertService) {}
  reconcile(alerts: Alert[]) {
    this.wanted = alerts;
    this.revision++;
    return (this.running ??= this.run().finally(() => {
      this.running = null;
    }));
  }
  private async run() {
    let handled = -1;
    while (handled !== this.revision) {
      handled = this.revision;
      const wanted = this.wanted;
      const existing = await this.service.list();
      if (handled !== this.revision) continue;
      const desired = new Map(wanted.map((row) => [row.id, row]));
      const same = new Set<string>();
      for (const row of existing) {
        const next = desired.get(row.id);
        if (next && row.signature === alertSignature(next)) same.add(row.id);
        else await this.service.cancel(row.id);
        if (handled !== this.revision) break;
      }
      if (handled !== this.revision) continue;
      for (const row of wanted) {
        if (same.has(row.id)) continue;
        await this.service.schedule(row);
        if (handled !== this.revision) {
          await this.service.cancel(row.id);
          break;
        }
      }
    }
  }
}

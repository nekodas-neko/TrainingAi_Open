import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';

// The Health Connect import used to be saved as one value holding the record-id cache (never
// pruned), the scan's `seen` list and the upload queue, rewritten whole after every page (#3121).
// It is now saved in several kinds of entry, so a page writes only what it changed:
//   - the core record: the token, the cursor, the counters, the scan's position and the indexes
//     of the entries below;
//   - one entry per day of the record-id cache, keyed by the day the record starts (UTC, only as
//     a bucket), so a page of heart rate rewrites the day or two it touches;
//   - one entry per queued batch and per batch held for a revoked permission (#3117), so sending
//     or rotating one leaves the others alone;
//   - the scan's starting snapshot of ids once, and what it has seen in one entry per page.
// The shape handed in and out is the old single value's, so the store and its schema are
// unchanged. The move from that value follows the nutrition store's (#3096, #3108): new entries
// first, then the core record, then removals, the old value last, in one transaction.
const legacyKey = 'health-connect-import.v1';
const coreKey = 'health-connect-import.v2';
const dayPrefix = 'health-connect-ids.v1:';
const queuePrefix = 'health-connect-queue.v1:';
const heldPrefix = 'health-connect-held.v1:';
const seenPrefix = 'health-connect-seen.v1:';
const scanIdsKey = 'health-connect-scan-ids.v1';
const pad = (n: number) => String(n).padStart(9, '0');
const dayKey = (day: string) => dayPrefix + day;
const queueKey = (seq: number) => queuePrefix + pad(seq);
const heldKey = (seq: number) => heldPrefix + pad(seq);
const seenKey = (n: number) => seenPrefix + pad(n);
const prefixes = [dayPrefix, queuePrefix, heldPrefix, seenPrefix];

type Entry = { id: string; start: string } & Record<string, unknown>;
type Scan = { seen: string[]; oldIds: string[] } & Record<string, unknown>;
export type HealthConnectSaved = {
  records: Record<string, Entry>;
  queue: object[];
  blocked: object[];
  scan: Scan | null;
} & Record<string, unknown>;
type Core = Record<string, unknown> & {
  version: 2;
  days: string[];
  queue: number[];
  held: number[];
  next: number;
  scan: (Record<string, unknown> & { pages: number; seen: number }) | null;
};

const dayOf = (entry: Entry) => entry.start.slice(0, 10);
// Identifies one scan, so its id snapshot is written once and its pages appended.
const scanId = (scan: Scan) => JSON.stringify([scan.token, scan.from, scan.end, scan.types]);

export class HealthConnectPersistence {
  // What is on disk, so a write sends only the entries that changed.
  private core: string | null = null;
  private days = new Map<string, Map<string, Entry>>();
  private queue: number[] = [];
  private held: number[] = [];
  private seq = new WeakMap<object, number>();
  private next = 0;
  private scan: { id: string; pages: number; seen: number; last: string | undefined } | null = null;
  // Entries of the old shape, or left by a write cut short, that the next write removes last.
  private stale: string[] = [];
  private current = false;
  // What `read` found in the core record, until `opened` matches it to the parsed import.
  private read_ = { queue: [] as number[], held: [] as number[], pages: 0 };
  constructor(private storage: ScopedStorage) {}
  private async need(key: string) {
    const value = await this.storage.get(key);
    // An entry the index lists but storage lacks means the saved import is damaged: refuse to
    // open it rather than upload a partial queue and later save over what remains.
    if (value === null) throw new Error(`Saved Health Connect entry ${key} is missing.`);
    return value;
  }
  // The saved import in its old single-value shape, or null when nothing is saved.
  async read(): Promise<unknown> {
    const raw = await this.storage.get(coreKey);
    if (raw === null) {
      this.current = false;
      const legacy = await this.storage.get(legacyKey);
      // Leftovers of a move cut short before its core record landed are removed with the move.
      this.stale = [...(await this.listed()), ...(legacy === null ? [] : [legacyKey])];
      return legacy === null ? null : JSON.parse(legacy);
    }
    const core = JSON.parse(raw) as Core;
    const records: Record<string, Entry> = {};
    for (const day of core.days)
      Object.assign(records, JSON.parse(await this.need(dayKey(day))) as Record<string, Entry>);
    const queue = [];
    for (const seq of core.queue) queue.push(JSON.parse(await this.need(queueKey(seq))));
    const blocked = [];
    for (const seq of core.held) blocked.push(JSON.parse(await this.need(heldKey(seq))));
    let scan: Scan | null = null;
    if (core.scan) {
      const { pages, seen: _count, ...position } = core.scan;
      const seen: string[] = [];
      for (let n = 0; n < pages; n++)
        seen.push(...(JSON.parse(await this.need(seenKey(n))) as string[]));
      scan = {
        ...position,
        seen,
        oldIds: JSON.parse(await this.need(scanIdsKey)) as string[],
      } as Scan;
    }
    const listed = new Set([
      ...core.days.map(dayKey),
      ...core.queue.map(queueKey),
      ...core.held.map(heldKey),
      ...Array.from({ length: core.scan?.pages ?? 0 }, (_, n) => seenKey(n)),
    ]);
    this.current = true;
    this.next = core.next;
    this.read_ = { queue: core.queue, held: core.held, pages: core.scan?.pages ?? 0 };
    this.stale = [
      ...(await this.listed()).filter((key) => !listed.has(key)),
      ...(core.scan ? [] : (await this.storage.get(scanIdsKey)) === null ? [] : [scanIdsKey]),
      ...((await this.storage.get(legacyKey)) === null ? [] : [legacyKey]),
    ];
    const { version: _v, days: _d, queue: _q, held: _h, next: _n, scan: _s, ...rest } = core;
    return { ...rest, records, queue, blocked, scan };
  }
  private async listed() {
    if (!this.storage.keys) return [];
    const found: string[] = [];
    for (const prefix of prefixes) found.push(...(await this.storage.keys(prefix)));
    return found;
  }
  // Called with the import the store opened, after its schema check. An old shape moves across
  // now, in one transaction that removes the old value last; if that fails, the old value stays
  // readable and the next write retries. Otherwise the import is what is on disk, so the next
  // write sends only what it changes.
  async opened(saved: HealthConnectSaved) {
    if (this.current) this.remember(saved);
    if (this.stale.length) await this.write(saved);
  }
  // Records an import just read as what is on disk.
  private remember(saved: HealthConnectSaved) {
    this.days = this.group(saved.records);
    // The parsed items are new objects: each takes the number its entry is saved under.
    const keep = (items: object[], seqs: number[]) =>
      items.map((item, index) => {
        this.seq.set(item, seqs[index]);
        return seqs[index];
      });
    this.queue = keep(saved.queue, this.read_.queue);
    this.held = keep(saved.blocked, this.read_.held);
    this.scan = saved.scan
      ? {
          id: scanId(saved.scan),
          pages: this.read_.pages,
          seen: saved.scan.seen.length,
          last: saved.scan.seen.at(-1),
        }
      : null;
    this.core = JSON.stringify(
      this.coreOf(saved, this.days, this.queue, this.held, this.scan?.pages ?? 0),
    );
  }
  private group(records: Record<string, Entry>) {
    const days = new Map<string, Map<string, Entry>>();
    for (const entry of Object.values(records)) {
      const day = dayOf(entry);
      let ids = days.get(day);
      if (!ids) days.set(day, (ids = new Map()));
      ids.set(entry.id, entry);
    }
    return days;
  }
  private coreOf(
    saved: HealthConnectSaved,
    days: Map<string, unknown>,
    queue: number[],
    held: number[],
    pages: number,
  ): Core {
    const { records: _r, queue: _q, blocked: _b, scan, ...rest } = saved;
    let position: Core['scan'] = null;
    if (scan) {
      const { seen, oldIds: _o, ...kept } = scan;
      position = { ...kept, pages, seen: seen.length };
    }
    return {
      ...rest,
      version: 2,
      days: [...days.keys()].sort(),
      queue,
      held,
      next: this.next,
      scan: position,
    };
  }
  async write(saved: HealthConnectSaved) {
    const changes: [string, string | null][] = [];
    const removals: string[] = [];
    // The record-id cache, by day: a day is rewritten only if an id in it was added, removed or
    // replaced.
    const days = this.group(saved.records);
    for (const [day, ids] of days) {
      const before = this.days.get(day);
      const same =
        before?.size === ids.size && [...ids].every(([id, entry]) => before.get(id) === entry);
      if (!same) changes.push([dayKey(day), JSON.stringify(Object.fromEntries(ids))]);
    }
    for (const day of this.days.keys()) if (!days.has(day)) removals.push(dayKey(day));
    // Queued and held batches: a batch is written once, under a number it keeps while it waits.
    const batches = (items: object[], previous: number[], key: (seq: number) => string) => {
      const before = new Set(previous);
      const used = new Set<number>();
      const seqs = items.map((item) => {
        let seq = this.seq.get(item);
        if (seq === undefined || used.has(seq)) {
          seq = this.next++;
          this.seq.set(item, seq);
        }
        // Not on disk under this list yet (new, moved between the queue and the held list, or
        // its write failed last time).
        if (!before.has(seq)) changes.push([key(seq), JSON.stringify(item)]);
        used.add(seq);
        return seq;
      });
      for (const seq of previous) if (!used.has(seq)) removals.push(key(seq));
      return seqs;
    };
    const queue = batches(saved.queue, this.queue, queueKey);
    const held = batches(saved.blocked, this.held, heldKey);
    // The scan: its id snapshot once, then what each page saw.
    let scan = this.scan;
    const id = saved.scan ? scanId(saved.scan) : null;
    if (scan && scan.id !== id) {
      for (let n = 0; n < scan.pages; n++) removals.push(seenKey(n));
      removals.push(scanIdsKey);
      scan = null;
    }
    if (saved.scan && id) {
      const seen = saved.scan.seen;
      if (!scan) {
        changes.push([scanIdsKey, JSON.stringify(saved.scan.oldIds)]);
        scan = { id, pages: 0, seen: 0, last: undefined };
      } else if (seen.length < scan.seen || (scan.seen > 0 && seen[scan.seen - 1] !== scan.last)) {
        // Not an extension of what is saved: write it again from the first page.
        for (let n = 0; n < scan.pages; n++) removals.push(seenKey(n));
        scan = { id, pages: 0, seen: 0, last: undefined };
      }
      if (seen.length > scan.seen) {
        changes.push([seenKey(scan.pages), JSON.stringify(seen.slice(scan.seen))]);
        scan = { id, pages: scan.pages + 1, seen: seen.length, last: seen.at(-1) };
      }
    }
    const core = JSON.stringify(this.coreOf(saved, days, queue, held, scan?.pages ?? 0));
    // New entries first, then the core record that lists them, then removals and the old shape:
    // a write cut short without a transaction leaves whichever core is saved pointing at entries
    // that are all there.
    if (core !== this.core) changes.push([coreKey, core]);
    const writing = new Set(changes.map(([key]) => key));
    for (const key of [...removals, ...this.stale])
      if (!writing.has(key)) changes.push([key, null]);
    // What is on disk changes only once the write lands; a failed one is compared against the
    // old state again next time.
    if (changes.length) await this.save(changes);
    this.core = core;
    this.days = days;
    this.queue = queue;
    this.held = held;
    this.scan = scan;
    this.stale = [];
    return changes.length;
  }
  private async save(changes: [string, string | null][]) {
    if (this.storage.setMany) {
      await this.storage.setMany(changes);
      return;
    }
    for (const [key, value] of changes)
      await (value === null ? this.storage.remove(key) : this.storage.set(key, value));
  }
}

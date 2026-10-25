import { z } from 'zod';
import {
  REQUEST_MEASUREMENT_CMD,
  REQUEST_STORED_MEASUREMENTS_CMD,
  SCALE_SERVICE,
  isNewWeighInEvidence,
  isRepeatedStableFrame,
  parseStoredRecord,
  parseWeightPacket,
} from '@trainingai/shared/devices/scale-protocol';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import type {
  BleAdapter,
  BlePermission,
  BleRadio,
  FoundDevice,
  ScaleLink,
  Unsubscribe,
} from '../../../integrations/ble/types.ts';
import type { ScaleOutbox, ScaleOutcome, ScaleReading } from './ScaleOutbox.ts';
import { resultOfVerdict, type WeighResult } from './labels.ts';

// One body-composition scale per phone (the Renpho ES-20M, a QN-Scale). The scale sleeps within
// seconds of a weigh-in and does not advertise while idle, so the link works as the current app's
// `ScaleBleService` does: scan for it, connect the moment it is seen advertising, ask for a
// measurement, then keep the link open to catch every weigh-in on it. Here that happens only while
// Preview is in the foreground (or the Devices screen is open); the current app's background
// service has no equivalent yet. The timings below are `ScaleBleService`'s and `ScaleGattClient`'s.
const PAIRED_KEY = 'paired-scale.v1';
/** Attempts to reach a first live link after a scan hit. */
const MAX_ATTEMPTS = 5;
const RETRY_GAP_MS = 2_000;
/** Bounds only reaching a first live link, timed from the first attempt; the scale stays reachable ~19 s. */
export const CYCLE_BUDGET_MS = 16_000;
/** After a request is written, silence this long means the notify subscription never took. */
const EARLY_DATA_MS = 5_000;
/** Bounds how soon a new cycle starts after one gave up, while the scale settles back to sleep. */
const GIVE_UP_COOLDOWN_MS = 5_000;
export const SCAN_MS = 20_000;

const pairedSchema = z.object({ id: z.string().min(1), name: z.string() });
export type PairedScale = z.infer<typeof pairedSchema>;
/** `app` holds the link on every screen while Preview is in the foreground (#3158). */
export type ScaleHold = 'settings' | 'app';
export type ScalePhase =
  | 'idle'
  | 'listening'
  | 'connecting'
  | 'connected'
  | 'weighing'
  | 'radioOff';
export type ScaleState = {
  ready: boolean;
  available: boolean;
  paired: PairedScale | null;
  phase: ScalePhase;
  radio: BleRadio;
  permission: BlePermission | null;
  /** The prompt has been shown since launch, so 'denied' is an answer rather than "not asked yet". */
  permissionAsked: boolean;
  /** The settling weight while someone is on the scale. */
  weightKg: number | null;
  /** What the last weigh-in came to, until the next one starts. */
  result: WeighResult | null;
  /** Weigh-ins saved on the phone and not yet filed. */
  queued: number;
  scanning: boolean;
  /** A scan has finished since the screen opened, so "nothing found" is a real answer. */
  scanned: boolean;
  found: FoundDevice[];
  scanError: string | null;
};
type Timers = { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
export type ScaleDeps = {
  ble: BleAdapter;
  /** Device scope: the scale belongs to the phone, not the account. */
  storage: ScopedStorage;
  now?: () => number;
  timers?: Timers;
};

export class ScaleSession {
  private current: ScaleState;
  private listeners = new Set<() => void>();
  private holds = new Set<ScaleHold>();
  private outbox: ScaleOutbox | null = null;
  private initialized: Promise<void> | null = null;
  private now: () => number;
  private timers: Timers;
  private stopRadio: Unsubscribe | null = null;
  private stopScan: Unsubscribe | null = null;
  private scanTimer: unknown = null;
  // The weigh-in cycle.
  private active = false;
  private generation = 0;
  private link: ScaleLink | null = null;
  private stopMeasure: Unsubscribe | null = null;
  private cycleTimer: unknown = null;
  private earlyTimer: unknown = null;
  private cycleStart = 0;
  private attempts = 0;
  private linked = false;
  private cooldownUntil = 0;
  private lastStable: { rawHex: string; at: number } | null = null;
  private lastCapturedKg: number | null = null;
  /** Someone has been on the scale and nothing has been captured since. */
  private sawActivity = false;
  private captured = false;

  constructor(private deps: ScaleDeps) {
    this.now = deps.now ?? Date.now;
    this.timers = deps.timers ?? {
      set: (run, ms) => setTimeout(run, ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.current = {
      ready: false,
      available: deps.ble.available,
      paired: null,
      phase: 'idle',
      radio: 'unknown',
      permission: null,
      permissionAsked: false,
      weightKg: null,
      result: null,
      queued: 0,
      scanning: false,
      scanned: false,
      found: [],
      scanError: null,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.current;
  private publish(patch: Partial<ScaleState>) {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  initialize() {
    return (this.initialized ??= (async () => {
      const paired = await this.deps.storage.get(PAIRED_KEY).catch(() => null);
      const parsed = paired ? pairedSchema.safeParse(safeJson(paired)) : null;
      if (this.deps.ble.available) {
        this.stopRadio = this.deps.ble.onRadioChange((radio) => this.applyRadio(radio));
      }
      this.publish({ ready: true, paired: parsed?.success ? parsed.data : null });
      await this.refreshAccess(false);
      this.updateWanted();
    })());
  }

  /** Reads the radio and permission; `request` shows the permission prompt. */
  async refreshAccess(request: boolean) {
    if (!this.deps.ble.available) return false;
    const permission = await this.deps.ble
      .permission(request)
      .catch(() => 'denied' as const);
    this.publish({ permission, ...(request ? { permissionAsked: true } : {}) });
    if (permission === 'granted')
      this.applyRadio(await this.deps.ble.radio().catch(() => 'unknown' as const));
    return permission === 'granted';
  }

  private applyRadio(radio: BleRadio) {
    this.publish({ radio });
    this.updateWanted();
  }

  /** Account change: weigh-ins saved for the old account stay with it. */
  setOutbox(outbox: ScaleOutbox | null) {
    if (outbox === this.outbox) return;
    this.outbox = outbox;
    this.publish({ queued: outbox?.pending() ?? 0 });
    void outbox?.sync().then(() => this.publish({ queued: outbox.pending() }));
  }

  /** Sends whatever is saved. The provider calls it on a timer and when the app returns. */
  sync() {
    const outbox = this.outbox;
    void outbox?.sync().then(() => this.publish({ queued: outbox.pending() }));
  }

  /** What the outbox reports for a reading it sent. */
  applyOutcome(outcome: ScaleOutcome) {
    const result: WeighResult =
      outcome.kind === 'verdict'
        ? resultOfVerdict(outcome.verdict, outcome.reading.weightKg)
        : { kind: 'failed' };
    this.publish({ result, queued: this.outbox?.pending() ?? 0 });
  }

  hold(reason: ScaleHold, on: boolean) {
    if (on === this.holds.has(reason)) return;
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    this.updateWanted();
  }

  private wanted() {
    return (
      this.holds.size > 0 &&
      this.current.ready &&
      !!this.current.paired &&
      this.current.permission === 'granted' &&
      this.deps.ble.available &&
      (this.current.radio === 'on' || this.current.radio === 'unknown')
    );
  }

  private updateWanted() {
    if (!this.current.ready) return;
    const wanted = this.wanted();
    if (wanted && !this.active) {
      this.active = true;
      this.listen();
    } else if (!wanted && this.active) {
      this.active = false;
      this.stopCycle();
      const radioOff =
        this.holds.size > 0 && !!this.current.paired && this.current.radio === 'off';
      this.publish({ phase: radioOff ? 'radioOff' : 'idle', weightKg: null });
    } else if (!wanted && !this.active) {
      const radioOff =
        this.holds.size > 0 && !!this.current.paired && this.current.radio === 'off';
      const phase = radioOff ? 'radioOff' : 'idle';
      if (this.current.phase !== phase) this.publish({ phase });
    }
  }

  /** Shows the permission prompt, then listens if a hold is waiting on it. */
  async allowAccess() {
    await this.refreshAccess(true);
    this.updateWanted();
  }

  /** Try now instead of waiting. Also re-checks access. */
  async retry() {
    await this.refreshAccess(false);
    this.updateWanted();
    // Already listening: start the scan afresh and skip the cool-down, so the button does something.
    if (this.active && this.current.phase === 'listening') {
      this.cooldownUntil = 0;
      this.listen();
    }
  }

  // ---- the weigh-in cycle ----

  /** Waits for the paired scale to be seen advertising, then starts a connect cycle. */
  private listen() {
    this.stopListening();
    const paired = this.current.paired;
    if (!paired || !this.active) return;
    const wait = this.cooldownUntil - this.now();
    if (wait > 0) {
      this.publish({ phase: 'listening' });
      this.cycleTimer = this.timers.set(() => {
        this.cycleTimer = null;
        this.listen();
      }, wait);
      return;
    }
    this.publish({ phase: 'listening' });
    this.stopScan = this.deps.ble.scan(
      (device) => {
        if (device.id !== paired.id || !this.active) return;
        this.stopListening();
        this.cycleStart = this.now();
        this.attempts = 0;
        this.connect();
      },
      () => {
        // A scan that fails outright is tried again after the same cool-down a give-up takes.
        this.stopListening();
        this.cooldownUntil = this.now() + GIVE_UP_COOLDOWN_MS;
        if (this.active) this.listen();
      },
      SCALE_SERVICE,
    );
  }

  private stopListening() {
    this.stopScan?.();
    this.stopScan = null;
    if (this.cycleTimer !== null) this.timers.clear(this.cycleTimer);
    this.cycleTimer = null;
  }

  private connect() {
    const paired = this.current.paired;
    if (!paired || !this.active) return;
    this.release();
    const generation = ++this.generation;
    this.attempts++;
    this.linked = false;
    this.publish({ phase: 'connecting' });
    this.deps.ble
      .connectScale(paired.id, () => {
        if (generation !== this.generation) return;
        this.onLinkLost();
      })
      .then((link) => {
        if (generation !== this.generation) {
          void link.disconnect();
          return;
        }
        this.link = link;
        this.stopMeasure = link.onMeasurement(
          (value) => {
            if (generation === this.generation) this.onNotification(value);
          },
          () => {
            // Connected with no notifications is no link at all.
            if (generation === this.generation) this.onLinkLost();
          },
        );
        // Request after subscribing, in the order the current app writes them; the stored-readings
        // request goes last so it can never delay the live one.
        void link
          .request(Uint8Array.from(REQUEST_MEASUREMENT_CMD))
          .then(() => {
            if (generation !== this.generation) return;
            this.earlyTimer = this.timers.set(() => {
              this.earlyTimer = null;
              if (generation === this.generation && !this.linked) this.onLinkLost();
            }, EARLY_DATA_MS);
            return link.request(Uint8Array.from(REQUEST_STORED_MEASUREMENTS_CMD));
          })
          .catch(() => {
            if (generation === this.generation && !this.linked) this.onLinkLost();
          });
      })
      .catch(() => {
        if (generation === this.generation) this.onLinkLost();
      });
  }

  /** A connect failed or a live link dropped: retry within the budget, or wait for the next wake. */
  private onLinkLost() {
    const wasLinked = this.linked;
    this.release();
    if (!this.active) return;
    if (wasLinked) {
      // The scale drops the link itself after a reading, which is not a failure. Dropping it with
      // someone mid-weigh-in and nothing captured is: they stepped off too early.
      const missed = this.sawActivity && !this.captured;
      if (missed) this.sawActivity = false;
      this.publish({
        phase: 'listening',
        weightKg: null,
        ...(missed ? { result: { kind: 'failed' as const } } : {}),
      });
      this.listen();
      return;
    }
    const spent = this.now() - this.cycleStart;
    if (this.attempts < MAX_ATTEMPTS && spent + RETRY_GAP_MS < CYCLE_BUDGET_MS) {
      this.publish({ phase: 'connecting' });
      this.cycleTimer = this.timers.set(() => {
        this.cycleTimer = null;
        this.connect();
      }, RETRY_GAP_MS);
      return;
    }
    // Gave up. Only a weigh-in that was seen starting and never captured is reported as missed.
    if (this.sawActivity && !this.captured) {
      this.sawActivity = false;
      this.publish({ result: { kind: 'failed' }, weightKg: null });
    }
    this.cooldownUntil = this.now() + GIVE_UP_COOLDOWN_MS;
    this.listen();
  }

  private onNotification(value: Uint8Array) {
    // Any notification at all proves the link is alive, the handshake frame included.
    if (!this.linked) {
      this.linked = true;
      if (this.earlyTimer !== null) this.timers.clear(this.earlyTimer);
      this.earlyTimer = null;
      this.publish({ phase: 'connected' });
    }
    const stored = parseStoredRecord(value);
    if (stored) {
      this.save({
        rawHex: stored.rawHex,
        weightKg: stored.weightKg,
        impedanceOhmsA: stored.resistance1Ohms,
        impedanceOhmsB: stored.resistance2Ohms,
        measuredAt: new Date(stored.measuredAtEpochSeconds * 1000).toISOString(),
      });
      return;
    }
    const packet = parseWeightPacket(value);
    if (!packet) return;
    if (!packet.stable) {
      // A replay of the capture just taken is not someone stepping on.
      if (!isNewWeighInEvidence(packet.weightKg, this.lastCapturedKg)) return;
      this.sawActivity = true;
      this.captured = false;
      this.publish({ phase: 'weighing', weightKg: packet.weightKg, result: null });
      return;
    }
    const at = this.now();
    if (isRepeatedStableFrame(packet.rawHex, this.lastStable, at)) return;
    this.lastStable = { rawHex: packet.rawHex, at };
    this.lastCapturedKg = packet.weightKg;
    this.captured = true;
    this.sawActivity = false;
    this.publish({ phase: 'connected', weightKg: null });
    this.save({
      rawHex: packet.rawHex,
      weightKg: packet.weightKg,
      impedanceOhmsA: packet.impedanceOhmsA,
      impedanceOhmsB: packet.impedanceOhmsB,
      measuredAt: new Date(at).toISOString(),
    });
  }

  private save(reading: ScaleReading) {
    const outbox = this.outbox;
    if (!outbox) {
      // Nothing to file it under (signed out); the reading is lost rather than filed for no one.
      this.publish({ result: { kind: 'failed' } });
      return;
    }
    void outbox
      .append(reading)
      .then(() => {
        this.publish({ queued: outbox.pending() });
        return outbox.sync();
      })
      .then(() => {
        this.publish({ queued: outbox.pending() });
        // Still queued after a send means the connection failed, not the scale.
        if (outbox.pending() > 0) this.publish({ result: { kind: 'saved' } });
      })
      .catch(() => {});
  }

  private detach() {
    this.stopMeasure?.();
    this.stopMeasure = null;
    this.link = null;
    if (this.earlyTimer !== null) this.timers.clear(this.earlyTimer);
    this.earlyTimer = null;
  }

  private release() {
    this.generation++;
    const link = this.link;
    this.detach();
    void link?.disconnect().catch(() => {});
  }

  private stopCycle() {
    this.stopListening();
    this.release();
    this.cooldownUntil = 0;
    this.lastCapturedKg = null;
    this.sawActivity = false;
    this.captured = false;
  }

  // ---- pairing ----

  /** Asks for the permission if needed, then lists scales nearby. */
  async scan() {
    if (this.current.scanning) return;
    this.publish({ scanError: null, found: [] });
    if (!(await this.refreshAccess(true))) return;
    if (this.current.radio === 'off') return;
    this.publish({ scanning: true });
    this.stopScan = this.deps.ble.scan(
      (device) => {
        const found = this.current.found.filter((x) => x.id !== device.id);
        this.publish({
          found: [...found, device].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)),
        });
      },
      (message) => {
        this.endScan();
        this.publish({ scanError: message });
      },
      SCALE_SERVICE,
    );
    this.scanTimer = this.timers.set(() => this.endScan(), SCAN_MS);
  }

  endScan() {
    this.stopScan?.();
    this.stopScan = null;
    if (this.scanTimer !== null) this.timers.clear(this.scanTimer);
    this.scanTimer = null;
    if (this.current.scanning) this.publish({ scanning: false, scanned: true });
  }

  async pair(device: FoundDevice) {
    this.endScan();
    const paired: PairedScale = { id: device.id, name: device.name?.trim() || 'Scale' };
    this.stopActive();
    this.publish({ paired, found: [], result: null });
    await this.deps.storage.set(PAIRED_KEY, JSON.stringify(paired)).catch(() => {});
    this.updateWanted();
  }

  async forget() {
    this.stopActive();
    this.publish({ paired: null, phase: 'idle', weightKg: null, result: null });
    await this.deps.storage.remove(PAIRED_KEY).catch(() => {});
  }

  private stopActive() {
    if (!this.active) return;
    this.active = false;
    this.stopCycle();
  }

  dispose() {
    this.endScan();
    this.holds.clear();
    this.stopActive();
    this.stopRadio?.();
    this.stopRadio = null;
    this.initialized = null;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

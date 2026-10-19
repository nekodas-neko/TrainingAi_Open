import { z } from 'zod';
import {
  parseBatteryLevel,
  parseHeartRateMeasurement,
  parseRevisionString,
} from '@trainingai/shared/devices/heart-rate-measurement';
import { decideLowBatteryAlert } from '@trainingai/shared/devices/low-battery';
import { isPlausibleHrSample } from '@trainingai/shared/health/hr-smoothing';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import type {
  BleAdapter,
  BlePermission,
  BleRadio,
  FoundDevice,
  StrapLink,
  Unsubscribe,
} from '../../../integrations/ble/types.ts';
import {
  initialLink,
  linkStep,
  type LinkEvent,
  type LinkPhase,
  type LinkState,
} from './reconnect.ts';
import { MAX_SAVED_SAMPLES, type HrOutbox, type StrapSample } from './HrOutbox.ts';

// One chest strap per phone, reached over the standard Heart Rate Service. The link is held only
// while something wants it: an active workout (which also records) or the Devices screen (which
// shows the link and battery). The current app's equivalents are `lib/live-hr/chest-strap-source.ts`
// and `PolarStrapService.kt`; the timings below match them.
const PAIRED_KEY = 'paired-hr-strap.v1';
const BATTERY_ALERT_KEY = 'strap-battery-alert.v1';
/** Contact must be missing this long before the strap counts as off the chest. */
const NOT_WORN_GRACE_MS = 15_000;
const FLUSH_EVERY_MS = 10_000;
const FLUSH_AT_COUNT = 40;
const BATTERY_POLL_MS = 10 * 60_000;
export const SCAN_MS = 20_000;
/** The workout's in-memory trace, as the current app's `exercise-trace` keeps it: 90 min at 1 Hz. */
const MAX_TRACE_SAMPLES = 5_400;
/** A reading older than this is shown as held, not live (the current app's `useLiveHr`). */
export const STALE_MS = 8_000;

const pairedSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  battery: z.number().int().min(0).max(100).nullable().default(null),
  batteryAt: z.number().nullable().default(null),
  /** Device Information 0x2A26, kept so a PMD change after a Polar Flow update can be traced. */
  firmware: z.string().nullable().default(null),
});
export type PairedStrap = z.infer<typeof pairedSchema>;
export type StrapHold = 'workout' | 'settings';
export type StrapState = {
  ready: boolean;
  available: boolean;
  paired: PairedStrap | null;
  link: LinkPhase;
  radio: BleRadio;
  permission: BlePermission | null;
  /** The prompt has been shown since launch, so 'denied' is an answer rather than "not asked yet". */
  permissionAsked: boolean;
  bpm: number | null;
  bpmAt: number | null;
  /** False once the strap has reported no chest contact for the grace period. */
  worn: boolean;
  recording: boolean;
  /** This workout's plausible readings, for the rest-screen trace. Cleared when a workout starts. */
  trace: { at: number; bpm: number }[];
  scanning: boolean;
  /** A scan has finished since the screen opened, so "nothing found" is a real answer. */
  scanned: boolean;
  found: FoundDevice[];
  scanError: string | null;
};
type Timers = { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
export type StrapDeps = {
  ble: BleAdapter;
  /** Device scope: the strap belongs to the phone, not the account. */
  storage: ScopedStorage;
  now?: () => number;
  timers?: Timers;
  notifyLowBattery?: (percent: number) => Promise<void>;
};

export class StrapSession {
  private current: StrapState;
  private listeners = new Set<() => void>();
  private linkState: LinkState = initialLink;
  private holds = new Set<StrapHold>();
  private generation = 0;
  private link: StrapLink | null = null;
  private stopHr: Unsubscribe | null = null;
  private stopRadio: Unsubscribe | null = null;
  private stopScan: Unsubscribe | null = null;
  private waitTimer: unknown = null;
  private scanTimer: unknown = null;
  private flushTimer: unknown = null;
  private batteryTimer: unknown = null;
  private notWornSince: number | null = null;
  private buffer: StrapSample[] = [];
  private outbox: HrOutbox | null = null;
  /** The account the buffered samples were recorded for. */
  private bufferAccount: string | null = null;
  private batteryAlerted = false;
  private initialized: Promise<void> | null = null;
  private now: () => number;
  private timers: Timers;

  constructor(private deps: StrapDeps) {
    this.now = deps.now ?? Date.now;
    this.timers = deps.timers ?? {
      set: (run, ms) => setTimeout(run, ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.current = {
      ready: false,
      available: deps.ble.available,
      paired: null,
      link: 'idle',
      radio: 'unknown',
      permission: null,
      permissionAsked: false,
      bpm: null,
      bpmAt: null,
      worn: true,
      recording: false,
      trace: [],
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
  private publish(patch: Partial<StrapState>) {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  initialize() {
    return (this.initialized ??= (async () => {
      const [paired, alert] = await Promise.all([
        this.deps.storage.get(PAIRED_KEY).catch(() => null),
        this.deps.storage.get(BATTERY_ALERT_KEY).catch(() => null),
      ]);
      const parsed = paired ? pairedSchema.safeParse(safeJson(paired)) : null;
      this.batteryAlerted = alert === 'fired';
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
    const permission = await this.deps.ble.permission(request).catch(() => 'denied' as const);
    this.publish({ permission, ...(request ? { permissionAsked: true } : {}) });
    if (permission === 'granted')
      this.applyRadio(await this.deps.ble.radio().catch(() => 'unknown' as const));
    return permission === 'granted';
  }

  private applyRadio(radio: BleRadio) {
    this.publish({ radio });
    // 'unknown' is the brief state before the adapter reports; an attempt then simply fails and retries.
    const on = radio === 'on' || radio === 'unknown';
    if (on !== this.linkState.radioOn) this.step({ type: 'radio', on });
  }

  /** Account change: unsent samples go to the outbox they were recorded for. */
  setOutbox(outbox: HrOutbox | null) {
    if (outbox === this.outbox) return;
    this.flush();
    this.outbox = outbox;
    if (outbox) {
      // Samples kept through a sign-out or an expired session belong to whoever recorded them.
      if (this.bufferAccount !== null && this.bufferAccount !== outbox.account)
        this.buffer.splice(0);
      this.bufferAccount = outbox.account;
      this.flush();
    }
    void outbox?.sync();
  }

  /** Uploads whatever is saved. The provider calls it on a timer and when the app returns. */
  sync() {
    void this.outbox?.sync();
  }

  hold(reason: StrapHold, on: boolean) {
    if (on === this.holds.has(reason)) return;
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    if (reason === 'workout') this.setRecording(on);
    this.updateWanted();
  }

  private setRecording(on: boolean) {
    this.publish(on ? { recording: true, trace: [] } : { recording: false });
    if (on) {
      this.scheduleFlush();
      return;
    }
    if (this.flushTimer !== null) this.timers.clear(this.flushTimer);
    this.flushTimer = null;
    this.flush();
  }

  private scheduleFlush() {
    this.flushTimer = this.timers.set(() => {
      this.flush();
      if (this.current.recording) this.scheduleFlush();
    }, FLUSH_EVERY_MS);
  }

  private flush() {
    const outbox = this.outbox;
    // With no account to save to (signed out, session expired) the samples wait here.
    if (!this.buffer.length || !outbox) return;
    const samples = this.buffer.splice(0);
    void outbox
      .append(samples)
      .then(() => outbox.sync())
      .catch(() => {});
  }

  private updateWanted() {
    if (!this.current.ready) return;
    const wanted =
      this.holds.size > 0 &&
      !!this.current.paired &&
      this.current.permission === 'granted' &&
      this.deps.ble.available;
    if (wanted !== this.linkState.wanted) this.step({ type: wanted ? 'want' : 'unwant' });
  }

  /** Shows the permission prompt, then connects if a hold is waiting on it. */
  async allowAccess() {
    await this.refreshAccess(true);
    this.updateWanted();
  }

  /** Try now instead of waiting for the next retry. Also re-checks access. */
  async retry() {
    await this.refreshAccess(false);
    this.updateWanted();
    this.step({ type: 'retry' });
  }

  private step(event: LinkEvent) {
    const { state, effect } = linkStep(this.linkState, event);
    this.linkState = state;
    if (this.waitTimer !== null && state.phase !== 'waiting') {
      this.timers.clear(this.waitTimer);
      this.waitTimer = null;
    }
    if (state.phase !== this.current.link) this.publish({ link: state.phase });
    switch (effect.type) {
      case 'connect':
        this.connect();
        break;
      case 'disconnect':
        this.release();
        break;
      case 'wait':
        if (this.waitTimer !== null) this.timers.clear(this.waitTimer);
        this.waitTimer = this.timers.set(() => {
          this.waitTimer = null;
          this.step({ type: 'timer' });
        }, effect.ms);
        break;
    }
  }

  private connect() {
    const paired = this.current.paired;
    if (!paired) {
      this.step({ type: 'lost' });
      return;
    }
    this.release();
    const generation = ++this.generation;
    this.deps.ble
      .connect(paired.id, () => {
        if (generation !== this.generation) return;
        this.detach();
        this.step({ type: 'lost' });
      })
      .then((link) => {
        if (generation !== this.generation) {
          void link.disconnect();
          return;
        }
        this.link = link;
        this.notWornSince = null;
        this.publish({ worn: true });
        this.stopHr = link.onHeartRate(
          (value) => this.onHeartRate(value),
          () => {
            // Connected with no notifications is no link at all: drop it and reconnect.
            if (generation !== this.generation) return;
            this.release();
            this.step({ type: 'lost' });
          },
        );
        if (generation !== this.generation) return;
        this.step({ type: 'connected' });
        if (this.link !== link) return;
        this.pollBattery(link, generation);
        if (this.current.paired?.firmware === null) void this.readFirmware(link, generation);
      })
      .catch(() => {
        if (generation === this.generation) this.step({ type: 'lost' });
      });
  }

  private detach() {
    this.stopHr?.();
    this.stopHr = null;
    this.link = null;
    if (this.batteryTimer !== null) this.timers.clear(this.batteryTimer);
    this.batteryTimer = null;
  }

  private release() {
    this.generation++;
    const link = this.link;
    this.detach();
    void link?.disconnect().catch(() => {});
  }

  private onHeartRate(value: Uint8Array) {
    const reading = parseHeartRateMeasurement(value);
    if (!reading) return;
    const at = this.now();
    // A strap with no contact detection reports null and counts as worn.
    if (reading.contact !== false) this.notWornSince = null;
    else this.notWornSince ??= at;
    const worn = this.notWornSince === null || at - this.notWornSince <= NOT_WORN_GRACE_MS;
    // Off the chest the strap reports junk; it is shown as such and never saved.
    const keep = worn && this.current.recording;
    const trace = this.current.trace;
    // The current app's display filter: a strap-on 0 or a lone spike never reaches the trace.
    const plausible =
      keep &&
      isPlausibleHrSample(
        reading.bpm,
        trace.slice(-8).map((x) => x.bpm),
      );
    this.publish({
      bpm: reading.bpm,
      bpmAt: at,
      worn,
      ...(plausible
        ? { trace: [...trace.slice(-(MAX_TRACE_SAMPLES - 1)), { at, bpm: reading.bpm }] }
        : {}),
    });
    if (!keep) return;
    this.buffer.push({ at, bpm: reading.bpm, rr: reading.rr.slice(0, 100) });
    if (this.buffer.length > MAX_SAVED_SAMPLES)
      this.buffer.splice(0, this.buffer.length - MAX_SAVED_SAMPLES);
    if (this.buffer.length >= FLUSH_AT_COUNT) this.flush();
  }

  private async readFirmware(link: StrapLink, generation: number) {
    const value = await link.readFirmware().catch(() => null);
    const firmware = value ? parseRevisionString(value) : null;
    const paired = this.current.paired;
    if (generation !== this.generation || !firmware || !paired) return;
    const next = { ...paired, firmware };
    this.publish({ paired: next });
    await this.deps.storage.set(PAIRED_KEY, JSON.stringify(next)).catch(() => {});
  }

  private pollBattery(link: StrapLink, generation: number) {
    void link.readBattery().then((value) => {
      if (generation !== this.generation) return;
      const percent = value ? parseBatteryLevel(value) : null;
      if (percent !== null) void this.applyBattery(percent);
      this.batteryTimer = this.timers.set(
        () => this.pollBattery(link, generation),
        BATTERY_POLL_MS,
      );
    });
  }

  private async applyBattery(percent: number) {
    const paired = this.current.paired;
    if (!paired) return;
    const next = { ...paired, battery: percent, batteryAt: this.now() };
    this.publish({ paired: next });
    await this.deps.storage.set(PAIRED_KEY, JSON.stringify(next)).catch(() => {});
    // A coin cell cannot charge, so `charging` is always false (as in PolarStrapService).
    const decision = decideLowBatteryAlert(percent, false, this.batteryAlerted);
    if (decision.fired !== this.batteryAlerted) {
      this.batteryAlerted = decision.fired;
      await this.deps.storage
        .set(BATTERY_ALERT_KEY, decision.fired ? 'fired' : 'armed')
        .catch(() => {});
    }
    if (decision.notify) await this.deps.notifyLowBattery?.(percent).catch(() => {});
  }

  /** Asks for the permission if needed, then lists Heart Rate Service straps nearby. */
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
    const paired: PairedStrap = {
      id: device.id,
      name: device.name?.trim() || 'Heart-rate strap',
      battery: null,
      batteryAt: null,
      firmware: null,
    };
    if (this.current.paired) this.forgetLink();
    this.publish({ paired, found: [] });
    await this.deps.storage.set(PAIRED_KEY, JSON.stringify(paired)).catch(() => {});
    this.updateWanted();
  }

  async forget() {
    this.forgetLink();
    this.publish({ paired: null, bpm: null, bpmAt: null, worn: true });
    this.batteryAlerted = false;
    await Promise.all([
      this.deps.storage.remove(PAIRED_KEY).catch(() => {}),
      this.deps.storage.remove(BATTERY_ALERT_KEY).catch(() => {}),
    ]);
  }

  private forgetLink() {
    if (this.linkState.wanted) this.step({ type: 'unwant' });
    else this.release();
  }

  dispose() {
    this.endScan();
    this.holds.clear();
    this.setRecording(false);
    this.step({ type: 'unwant' });
    this.release();
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

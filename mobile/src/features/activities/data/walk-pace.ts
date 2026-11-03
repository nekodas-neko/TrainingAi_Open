import {
  STRAP_STALE_MS,
  STRAP_WINDOW_SEC,
  cadenceFieldsForSave,
  detectCadence,
  stepsFromCadenceSeries,
  summarizeCadence,
  type CadenceFields,
  type CadenceReading,
} from '@trainingai/shared/health/cadence';
import { stepsEstimateIfCovered } from '@trainingai/shared/health/cadence-coverage';
import {
  addPacerTick,
  summarisePacerTally,
  type PacerSegmentTally,
} from '@trainingai/shared/health/pacer-adherence';
import type { RoutePoint } from '@trainingai/shared/activity/route-encoding';
import {
  readPacer,
  resolveCadenceTargets,
  type CadenceStatus,
  windowedSpeedKmh,
  type PacerReading,
  type TargetPair,
} from '@trainingai/shared/walking/walk-pacer';
import type { AccelPhase, StrapState } from '../../devices/strap/StrapSession.ts';
import { liveHrView } from '../../devices/strap/labels.ts';
import type { LinkPhase } from '../../devices/strap/reconnect.ts';

type PlanSegment = {
  index: number;
  setNumber: number;
  kind: 'warmup' | 'fast' | 'slow' | 'cooldown';
  startSec: number;
  endSec: number;
};

/**
 * The two rungs below cadence, GPS speed and heart rate, read now (null is "no reading"), and what
 * the strap is doing about cadence, which words the fallback note.
 */
export type PaceSignals = {
  speedKmh: number | null;
  bpm: number | null;
  cadenceStatus?: CadenceStatus;
};
export const noSignals: PaceSignals = { speedKmh: null, bpm: null };

/** What the strap is doing about step pacing, from its link and accelerometer phase. */
export function cadenceStatusOf(strap: StrapState | null): CadenceStatus {
  if (!strap || !strap.paired) return 'none';
  if (strap.accel === 'unavailable') return 'unavailable';
  if (strap.link !== 'connected') return 'none';
  return strap.accel === 'starting' || strap.accel === 'streaming' ? 'reading' : 'none';
}

/**
 * The live step rate from the strap's accelerometer batches: the one derivation of cadence, used by
 * the guided walk's pacer and by the readout on every other walk, run and treadmill. It keeps the
 * last few seconds of magnitudes, finds the stride frequency with `detectCadence`, and treats a
 * reading older than `STRAP_STALE_MS` as gone.
 */
export class CadenceMeter {
  private magnitudes: number[] = [];
  private latest: { spm: number; atMs: number } | null = null;

  /** One batch of magnitudes (about a second at 50 Hz). Returns the cadence it produced, if any. */
  push(batch: { magnitudes: number[]; sampleRate: number; at: number }): CadenceReading | null {
    const rate = batch.sampleRate > 0 ? batch.sampleRate : 50;
    this.magnitudes.push(...batch.magnitudes);
    const cap = Math.round(STRAP_WINDOW_SEC * rate);
    if (this.magnitudes.length > cap) this.magnitudes.splice(0, this.magnitudes.length - cap);
    const estimate = detectCadence(this.magnitudes, rate);
    this.latest = estimate === null ? null : { spm: estimate.cadenceSpm, atMs: batch.at };
    return this.latest ? { atMs: batch.at, spm: this.latest.spm, source: 'strap' } : null;
  }

  /** The latest cadence, unless it has gone stale. */
  live(nowMs: number): number | null {
    return this.latest && nowMs - this.latest.atMs <= STRAP_STALE_MS ? this.latest.spm : null;
  }

  /** Forgets the window, so a gap (a pause) is not read across. */
  reset() {
    this.magnitudes = [];
    this.latest = null;
  }
}

/**
 * The speed and heart-rate readings the pacer may fall back to, as the current app's walk screen
 * reads them (#3549).
 *
 * - Speed is the trailing-window speed over the route's fixes (`windowedSpeedKmh`), null with under
 *   two fixes. A treadmill walk records no route (and the flag is checked as well), so it has no
 *   speed and falls to heart rate; it is never paced by GPS jitter indoors.
 * - Heart rate is the strap's smoothed reading, only while it is live (a held last reading is not
 *   paced against).
 */
export function paceSignals(input: {
  route: RoutePoint[];
  treadmill: boolean;
  strap: StrapState | null;
  nowMs: number;
  /** Fixes before this are ignored, so a speed is never read across a pause. */
  freshSinceMs?: number | null;
}): PaceSignals {
  const route =
    input.freshSinceMs == null ? input.route : input.route.filter((p) => p.t >= input.freshSinceMs!);
  const view = input.strap ? liveHrView(input.strap, input.nowMs, null, null) : null;
  return {
    speedKmh: input.treadmill ? null : windowedSpeedKmh(route),
    bpm: view && view.live ? view.bpm : null,
    cadenceStatus: cadenceStatusOf(input.strap),
  };
}

/**
 * The once-a-second pacer step, with the pause handled (#3553). Nothing is counted while the walk
 * is paused (the clock and the speed both stand still, so every second would tally the same
 * reading). After a resume, speed is read only from fixes taken since, so the gap is never a
 * stretch walked at near 0 km/h; until two fresh fixes arrive the speed rung has no reading.
 */
export class PaceTicker {
  private wasPaused = false;
  private freshSinceMs: number | null = null;

  /** Returns true when a second was counted. */
  step(input: {
    pace: WalkPace;
    paused: boolean;
    at: number;
    segment: PlanSegment | undefined;
    route: RoutePoint[];
    treadmill: boolean;
    strap: StrapState | null;
  }): boolean {
    if (input.paused) {
      this.wasPaused = true;
      return false;
    }
    if (this.wasPaused) {
      this.wasPaused = false;
      this.freshSinceMs = input.at;
    }
    input.pace.tick(
      input.at,
      input.segment,
      paceSignals({
        route: input.route,
        treadmill: input.treadmill,
        strap: input.strap,
        nowMs: input.at,
        freshSinceMs: this.freshSinceMs,
      }),
    );
    return true;
  }
}

/** What survives an app kill: the tally and the cadence readings behind the saved series (#3549). */
export type PaceSnapshot = {
  startMs: number;
  tallies: Record<string, PacerSegmentTally>;
  /** `[seconds since the walk started, steps per minute]`, one per strap reading. */
  readings: [number, number][];
};

/**
 * A guided walk's live pacer and what it records (#3525, #3549): the current app's `CadenceTracker`
 * (strap source) with its `pacerTallies`, over the same shared maths. It holds the strap's
 * accelerometer magnitudes, derives a cadence from the last few seconds with `detectCadence`, and
 * once a second counts the band the walker was shown against the segment's target (#2242).
 *
 * The ladder is the shared one: cadence, then GPS speed against the walker's own history, then heart
 * rate. A walk with no signal on any rung shows no band and records no adherence, never a false zero.
 */
export class WalkPace {
  private meter = new CadenceMeter();
  private readings: CadenceReading[] = [];
  private tallies: Record<number, PacerSegmentTally> = {};
  readonly targets: TargetPair;
  private speedTargets: TargetPair | null = null;
  private hrTargets: TargetPair | null = null;

  constructor(
    readonly startMs: number,
    config: { fastCadenceSpm?: number; slowCadenceSpm?: number },
  ) {
    this.targets = resolveCadenceTargets(config);
  }

  /**
   * The targets for the two fallback rungs. Each stays off until it is known: a speed pair needs
   * enough past walks, a heart-rate pair needs the walker's max and resting HR.
   */
  setTargets(targets: { speed: TargetPair | null; hr: TargetPair | null }) {
    this.speedTargets = targets.speed;
    this.hrTargets = targets.hr;
  }

  /** One batch of accelerometer magnitudes (about a second at 50 Hz). */
  onBatch(batch: { magnitudes: number[]; sampleRate: number; at: number }) {
    const reading = this.meter.push(batch);
    if (reading) this.readings.push(reading);
  }

  /** Drops the cadence window, for a resume after a pause. */
  resetCadence() {
    this.meter.reset();
  }

  /** The cadence to show now: the strap's latest reading, unless it has gone stale. */
  live(nowMs: number): number | null {
    return this.meter.live(nowMs);
  }

  /** The pacer's reading for a fast or slow block; null in other blocks or with no cadence. */
  reading(
    nowMs: number,
    segment: PlanSegment | undefined,
    signals: PaceSignals = noSignals,
  ): PacerReading | null {
    if (!segment || (segment.kind !== 'fast' && segment.kind !== 'slow')) return null;
    return readPacer({
      kind: segment.kind,
      cadenceSpm: this.live(nowMs),
      speedKmh: signals.speedKmh,
      // A heart rate with no targets to judge it against is not a reading.
      bpm: this.hrTargets ? signals.bpm : null,
      cadenceTargets: this.targets,
      speedTargets: this.speedTargets,
      hrTargets: this.hrTargets ?? { fast: 0, slow: 0 },
      cadenceStatus: signals.cadenceStatus,
    });
  }

  /**
   * Counts one second of what the walker was shown (#2242). Called once a second by a timer of
   * its own, so a re-render cannot add a tick and two readings in a second cannot add two.
   */
  tick(nowMs: number, segment: PlanSegment | undefined, signals: PaceSignals = noSignals) {
    const shown = this.reading(nowMs, segment, signals);
    if (!shown || !segment) return;
    this.tallies[segment.index] = addPacerTick(
      this.tallies[segment.index],
      shown.signal,
      shown.band,
    );
  }

  /** True once there is something worth keeping across a kill. */
  get hasData() {
    return this.readings.length > 0 || Object.keys(this.tallies).length > 0;
  }

  /** The tally and readings, for the activity checkpoint. */
  snapshot(): PaceSnapshot {
    return {
      startMs: this.startMs,
      tallies: Object.fromEntries(Object.entries(this.tallies)),
      readings: this.readings.map((reading) => [
        Math.max(0, Math.round((reading.atMs - this.startMs) / 1000)),
        Math.round(reading.spm * 10) / 10,
      ]),
    };
  }

  /** Puts a checkpointed walk's tally and readings back, if it is this walk's. */
  restore(snapshot: PaceSnapshot) {
    if (snapshot.startMs !== this.startMs) return;
    this.tallies = Object.fromEntries(
      Object.entries(snapshot.tallies).map(([index, tally]) => [Number(index), tally]),
    );
    this.readings = snapshot.readings.map(([tSec, spm]) => ({
      atMs: this.startMs + tSec * 1000,
      spm,
      source: 'strap' as const,
    }));
  }

  /** What belongs on the activity row: avg, binned series and source, null when nothing was read. */
  cadenceFields(): CadenceFields {
    return cadenceFieldsForSave(summarizeCadence(this.readings, this.startMs));
  }

  /**
   * `cadenceFields` as the save schema takes them: a key is absent when nothing was measured. With
   * the walk's active seconds it also carries the walk-level `steps`, as the current app saves it
   * (`stepsEstimateIfCovered`), and leaves it out when the strap's cadence covers too little of the
   * walk to stand for it (#3541).
   */
  cadencePayload(activeSec?: number) {
    const fields = this.cadenceFields();
    const steps =
      activeSec === undefined
        ? null
        : stepsEstimateIfCovered(summarizeCadence(this.readings, this.startMs), activeSec);
    return {
      ...(steps !== null ? { steps } : {}),
      ...(fields.cadenceSpm !== null ? { cadenceSpm: fields.cadenceSpm } : {}),
      ...(fields.cadenceSeries !== null ? { cadenceSeries: fields.cadenceSeries } : {}),
      ...(fields.cadenceSource !== null ? { cadenceSource: fields.cadenceSource } : {}),
    };
  }

  /**
   * The walk's segments with cadence, steps and pacer adherence filled in from this walk, in the
   * shape `computeWalkSegmentStats` writes (a segment the pacer never judged carries no pacer keys).
   */
  segments<T extends PlanSegment>(segments: T[]) {
    const series = this.cadenceFields().cadenceSeries ?? [];
    return segments.map((segment) => {
      const from = segment.startSec;
      const to = segment.endSec;
      const inside = series.filter((point) => point.tSec >= from && point.tSec < to);
      const total = inside.length
        ? Math.round((inside.reduce((sum, point) => sum + point.spm, 0) / inside.length) * 10) / 10
        : null;
      const pacer = summarisePacerTally(this.tallies[segment.index]);
      return {
        ...segment,
        avgCadenceSpm: total,
        steps: stepsFromCadenceSeries(inside),
        ...(pacer ?? {}),
      };
    });
  }
}

/** What the guided walk's pacing card says, from the strap, GPS and the pacer (#3525, #3549). */
export type PacingView =
  | { state: 'none'; note: string }
  | { state: 'waiting'; note: string }
  | { state: 'unavailable'; note: string }
  | { state: 'live'; value: number; unit: 'spm' | 'km/h' | 'bpm'; reading: PacerReading };

const unitOf = { cadence: 'spm', speed: 'km/h', hr: 'bpm' } as const;

export function pacingView(input: {
  paired: boolean;
  link: LinkPhase;
  accel: AccelPhase;
  spm: number | null;
  reading: PacerReading | null;
  signals?: PaceSignals;
  /** Treadmill walks have no GPS speed to fall back on. */
  treadmill?: boolean;
}): PacingView {
  const signals = input.signals ?? noSignals;
  const reading = input.reading;
  if (reading) {
    // The reading names its own rung. Cadence is shown only while the strap link is up; a speed or
    // heart-rate reading stands on its own, and the card says which one it is (the fallback note).
    const value =
      reading.signal === 'cadence'
        ? input.spm
        : reading.signal === 'speed'
          ? signals.speedKmh
          : signals.bpm;
    if (value !== null && (reading.signal !== 'cadence' || input.link === 'connected'))
      return { state: 'live', value, unit: unitOf[reading.signal], reading };
  }
  if (!input.paired)
    return {
      state: 'none',
      note: input.treadmill
        ? 'No chest strap paired, so there is nothing to pace by on a treadmill. Pair one in Devices.'
        : 'No chest strap paired. This walk paces by GPS speed. Pair one in Devices to pace by cadence or heart rate.',
    };
  if (input.accel === 'unavailable')
    return {
      state: 'unavailable',
      note: 'The strap’s cadence stream could not start. Close any other app using the strap.',
    };
  if (input.link !== 'connected')
    return { state: 'waiting', note: 'Connecting to your strap…' };
  return { state: 'waiting', note: 'Strap connected. Waiting for your cadence — keep walking.' };
}

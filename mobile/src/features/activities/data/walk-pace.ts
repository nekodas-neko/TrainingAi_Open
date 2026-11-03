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
import {
  readPacer,
  resolveCadenceTargets,
  type PacerReading,
  type TargetPair,
} from '@trainingai/shared/walking/walk-pacer';
import type { AccelPhase } from '../../devices/strap/StrapSession.ts';
import type { LinkPhase } from '../../devices/strap/reconnect.ts';

type PlanSegment = {
  index: number;
  setNumber: number;
  kind: 'warmup' | 'fast' | 'slow' | 'cooldown';
  startSec: number;
  endSec: number;
};

/**
 * A guided walk's live cadence pacer and what it records (#3525): the current app's
 * `CadenceTracker` (strap source) with its `pacerTallies`, over the same shared maths. It holds the
 * strap's accelerometer magnitudes, derives a cadence from the last few seconds with `detectCadence`,
 * and once a second counts the band the walker was shown against the segment's target (#2242).
 *
 * Only the cadence rung is ported: Preview's walk has no speed or heart-rate pacing yet, so a walk
 * with no cadence shows no band and records no adherence, never a false zero.
 */
export class WalkPace {
  private magnitudes: number[] = [];
  private sampleRate = 50;
  private strap: { spm: number; atMs: number } | null = null;
  private readings: CadenceReading[] = [];
  private tallies: Record<number, PacerSegmentTally> = {};
  readonly targets: TargetPair;

  constructor(
    readonly startMs: number,
    config: { fastCadenceSpm?: number; slowCadenceSpm?: number },
  ) {
    this.targets = resolveCadenceTargets(config);
  }

  /** One batch of accelerometer magnitudes (about a second at 50 Hz). */
  onBatch(batch: { magnitudes: number[]; sampleRate: number; at: number }) {
    const rate = batch.sampleRate > 0 ? batch.sampleRate : 50;
    this.sampleRate = rate;
    this.magnitudes.push(...batch.magnitudes);
    const cap = Math.round(STRAP_WINDOW_SEC * rate);
    if (this.magnitudes.length > cap) this.magnitudes.splice(0, this.magnitudes.length - cap);
    const estimate = detectCadence(this.magnitudes, rate);
    this.strap = estimate === null ? null : { spm: estimate.cadenceSpm, atMs: batch.at };
    if (this.strap) this.readings.push({ atMs: batch.at, spm: this.strap.spm, source: 'strap' });
  }

  /** The cadence to show now: the strap's latest reading, unless it has gone stale. */
  live(nowMs: number): number | null {
    return this.strap && nowMs - this.strap.atMs <= STRAP_STALE_MS ? this.strap.spm : null;
  }

  /** The pacer's reading for a fast or slow block; null in other blocks or with no cadence. */
  reading(nowMs: number, segment: PlanSegment | undefined): PacerReading | null {
    if (!segment || (segment.kind !== 'fast' && segment.kind !== 'slow')) return null;
    return readPacer({
      kind: segment.kind,
      cadenceSpm: this.live(nowMs),
      speedKmh: null,
      bpm: null,
      cadenceTargets: this.targets,
      speedTargets: null,
      hrTargets: { fast: 0, slow: 0 },
    });
  }

  /**
   * Counts one second of what the walker was shown (#2242). Called once a second by a timer of
   * its own, so a re-render cannot add a tick and two readings in a second cannot add two.
   */
  tick(nowMs: number, segment: PlanSegment | undefined) {
    const shown = this.reading(nowMs, segment);
    if (!shown || !segment) return;
    this.tallies[segment.index] = addPacerTick(
      this.tallies[segment.index],
      shown.signal,
      shown.band,
    );
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

/** What the guided walk's pacing card says, from the strap and the pacer (#3525). */
export type PacingView =
  | { state: 'none'; note: string }
  | { state: 'waiting'; note: string }
  | { state: 'unavailable'; note: string }
  | { state: 'live'; spm: number; reading: PacerReading };

export function pacingView(input: {
  paired: boolean;
  link: LinkPhase;
  accel: AccelPhase;
  spm: number | null;
  reading: PacerReading | null;
}): PacingView {
  if (!input.paired)
    return { state: 'none', note: 'No chest strap paired. Pair one in Devices to pace by cadence.' };
  if (input.accel === 'unavailable')
    return {
      state: 'unavailable',
      note: 'The strap’s cadence stream could not start. Close any other app using the strap.',
    };
  if (input.spm !== null && input.reading && input.link === 'connected')
    return { state: 'live', spm: input.spm, reading: input.reading };
  if (input.link !== 'connected')
    return { state: 'waiting', note: 'Connecting to your strap…' };
  return { state: 'waiting', note: 'Strap connected. Waiting for your cadence — keep walking.' };
}

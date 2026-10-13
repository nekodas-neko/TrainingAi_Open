export interface HrBucket {
  minute: number;
  bpm: number;
}
export interface IntakeEvent {
  atMs: number;
  kcal: number;
}
export interface EnergyTimelineInput {
  dayStartMs: number;
  restingHr: number;
  restingBaseKcal: number;
  activeKcal: number;
  hr: HrBucket[];
  intake: IntakeEvent[];
  bucketMinutes?: number;
}
export interface EnergyBucket {
  startMin: number;
  intakeKcal: number;
  burnKcal: number;
  intakeCumKcal: number;
  burnCumKcal: number;
  hrGap: boolean;
}
export interface EnergyTimeline {
  buckets: EnergyBucket[];
  totals: {
    intakeKcal: number;
    burnKcal: number;
  };
  hrGapBuckets: number;
}
const MINUTES_PER_DAY = 24 * 60;
export function buildEnergyTimeline({
  dayStartMs,
  restingHr,
  restingBaseKcal,
  activeKcal,
  hr,
  intake,
  bucketMinutes = 60,
}: EnergyTimelineInput): EnergyTimeline {
  const width = bucketMinutes > 0 ? bucketMinutes : 60;
  const count = Math.ceil(MINUTES_PER_DAY / width);
  const elevationSum = new Array<number>(count).fill(0);
  const readings = new Array<number>(count).fill(0);
  const intakeKcal = new Array<number>(count).fill(0);
  const indexFor = (atMs: number): number | null => {
    const min = Math.floor((atMs - dayStartMs) / 60000);
    if (min < 0 || min >= MINUTES_PER_DAY) return null;
    return Math.floor(min / width);
  };
  for (const b of hr) {
    if (b.minute < 0 || b.minute >= MINUTES_PER_DAY) continue;
    const i = Math.floor(b.minute / width);
    readings[i] += 1;
    elevationSum[i] += Math.max(0, b.bpm - restingHr);
  }
  const weight = elevationSum.map((sum, i) => (readings[i] > 0 ? sum / readings[i] : 0));
  for (const e of intake) {
    const i = indexFor(e.atMs);
    if (i === null) continue;
    intakeKcal[i] += e.kcal;
  }
  const weightTotal = weight.reduce((a, b) => a + b, 0);
  const restPerBucket = restingBaseKcal / count;
  let intakeCum = 0;
  let burnCum = 0;
  const buckets: EnergyBucket[] = [];
  for (let i = 0; i < count; i++) {
    const activeShare =
      weightTotal > 0 ? activeKcal * (weight[i] / weightTotal) : activeKcal / count;
    const burn = restPerBucket + activeShare;
    intakeCum += intakeKcal[i];
    burnCum += burn;
    buckets.push({
      startMin: i * width,
      intakeKcal: intakeKcal[i],
      burnKcal: burn,
      intakeCumKcal: intakeCum,
      burnCumKcal: burnCum,
      hrGap: readings[i] === 0,
    });
  }
  return {
    buckets,
    totals: { intakeKcal: intakeCum, burnKcal: burnCum },
    hrGapBuckets: buckets.filter((b) => b.hrGap).length,
  };
}

"use client";

import { memo } from "react";
import { Dumbbell, Footprints, Moon, Scale } from "lucide-react";
import { Hypnogram } from "@/components/health/hypnogram";
import { formatTimeOfDay } from "@trainingai/shared/date-utils";
import type { DayLogResult, DayBodyMeta, DaySleep, DayHrPoint } from "@/app/api/day-log/route";
import type { EnergyBalanceResponse } from "@/app/api/nutrition/energy-balance/route";
import { energyDaySummary, type SessionKcal } from "@/components/health/day-detail/energy-summary";

/** Section heading — letterspaced micro-caps, matching the treatment chosen for the day screen. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="pb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{children}</p>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex-1 text-center">
      <span className="block text-[0.95rem] font-bold leading-none tabular-nums">{value}</span>
      <span className="mt-1 block text-[8.5px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
    </span>
  );
}

/** Two-column label→value list. Chosen over a tile grid: twelve equal tiles give weight no more
 *  prominence than bone mass, and the day screen is a record rather than a dashboard. */
function KeyValues({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-2 border-b border-white/5 py-1.5">
          <span className="truncate text-[11px] text-muted-foreground">{label}</span>
          <span className="flex-none text-[12.5px] font-bold tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );
}

const hm = (hours: number) => `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`;

/** Whole-day HR, already bucketed server-side (DAY_HR_BUCKET_MIN). Drawn as a plain polyline —
 *  a sparkline primitive would rescale per-render and this needs a stable 0-1440 x-axis so the
 *  overnight trough sits where the night was. */
export const DayHrTrace = memo(function DayHrTrace({ points }: { points: DayHrPoint[] }) {
  if (points.length < 2) return null;
  const bpms = points.map(p => p.bpm);
  const lo = Math.min(...bpms) - 3;
  const hi = Math.max(...bpms) + 3;
  const H = 40;
  const d = points
    .map(p => `${((p.minute / 1440) * 100).toFixed(2)},${(H - ((p.bpm - lo) / (hi - lo)) * H).toFixed(1)}`)
    .join(" ");
  return (
    <div>
      <svg viewBox={`0 0 100 ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden className="block">
        <polyline points={d} fill="none" stroke="var(--accent-amber)" strokeWidth={1.4}
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
        <span>12am</span><span>12pm</span><span>12am</span>
      </div>
    </div>
  );
});

export const TrainingSection = memo(function TrainingSection(
  { data, kcalBySession }: { data: DayLogResult; kcalBySession?: Map<string, SessionKcal> },
) {
  if (data.exercises.length === 0) return null;
  // Grouped by session **id**, not name (Q-391). A name is not identity: repeat the same session
  // twice in a day and the two cards would collide on the key. The duration now comes from the
  // id-keyed record too (Q-362b) — until then this grouped correctly and then printed the same
  // duration on both cards, because it looked the value up by name.
  const bySession = new Map<string, { name: string; exercises: typeof data.exercises }>();
  for (const ex of data.exercises) {
    const group = bySession.get(ex.workoutSessionId) ?? { name: ex.sessionName, exercises: [] };
    group.exercises.push(ex);
    bySession.set(ex.workoutSessionId, group);
  }
  return (
    <div>
      <SectionLabel>Training</SectionLabel>
      {[...bySession.entries()].map(([sessionId, { name: sessionName, exercises }]) => {
        const dur = data.workoutDurationsById[sessionId];
        const kcal = kcalBySession?.get(sessionId);
        // Derived here rather than server-side: the route already returns every set's weight and
        // rep count, so a second source of truth for volume would be a formula in two places.
        const volume = exercises.reduce((sum, ex) => {
          const reps = ex.reps ?? [];
          return sum + ex.setWeights.reduce((s, w, i) => s + (w ?? 0) * (reps[i] ?? 0), 0);
        }, 0);
        return (
          <div key={sessionId} className="mb-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
            <div className="flex items-center gap-2.5 pb-2.5">
              <Dumbbell className="h-4 w-4 flex-none" style={{ color: "var(--accent-cyan)" }} />
              <span className="text-[14.5px] font-bold tracking-tight">{sessionName}</span>
              {dur && (
                <span className="ml-auto text-[10.5px] text-muted-foreground">
                  {dur.start} → {dur.end} · {dur.minutes} min
                </span>
              )}
            </div>
            {exercises.map(ex => (
              <div key={ex.exerciseLogId} className="flex items-baseline gap-2.5 border-b border-white/5 py-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{ex.name}</span>
                <span className="flex-none text-[10.5px] tabular-nums text-muted-foreground">
                  {ex.sets ?? 0} × {ex.reps?.[0] ?? 0}
                </span>
                <span className="min-w-[46px] flex-none text-right text-[0.82rem] font-bold tabular-nums">
                  {ex.weightKg ?? "—"}
                  <i className="ml-0.5 text-[9px] font-semibold not-italic text-muted-foreground">kg</i>
                </span>
              </div>
            ))}
            {volume > 0 && (
              <div className="flex justify-between pt-2.5">
                <Stat value={Math.round(volume).toLocaleString()} label="Volume kg" />
                <Stat value={String(exercises.length)} label="Exercises" />
                <Stat value={String(exercises.reduce((n, e) => n + (e.sets ?? 0), 0))} label="Sets" />
                {/*
                  The tilde and the "est." are load-bearing, not decoration. Unlike the three stats
                  beside it, this is NOT derived from the sets, so sitting it in a row of measured
                  facts needs the label to say so.

                  **The basis is named because there are two of them (Q-421).** With a strap reading
                  it is Keytel from heart rate and it responds to effort; without one it is a MET
                  tier over the clock, so a 49-minute session moving 2,364 kg and one moving 800 kg
                  produce the same figure. About half the owner's sessions have no strap, so two
                  cards on one screen routinely come from different formulas whose outputs overlap
                  rather than agree — an unlabelled pair is not comparable and does not say it isn't.

                  Absent rather than zero when the estimate cannot be made — a profile without age,
                  weight or sex yields no figure, and a confident `0 kcal` would be indistinguishable
                  from a real one (the Q-278 class). **The guard is `> 0`, not `!= null`**: the
                  comment claimed this before the code did, and a `0` addend does reach here — the
                  sandbox's MET constant sits below `estWorkoutKcal`'s floor (Q-331), so a strapless
                  session rendered `~0 EST. MET KCAL` beside a real 378.
                */}
                {kcal != null && kcal.kcal > 0 && (
                  <Stat
                    value={`~${Math.round(kcal.kcal).toLocaleString()}`}
                    label={kcal.source === 'hr' ? 'Est. HR kcal' : 'Est. MET kcal'}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

/** `1h 05m` past the hour, `47m` below it — a walk and a long ride shouldn't share a format. */
function durationLabel(min: number): string {
  return min >= 60 ? `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m` : `${Math.round(min)}m`;
}

function paceLabel(secPerKm: number): string {
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}/km`;
}

export const ActivitySection = memo(function ActivitySection({ data }: { data: DayLogResult }) {
  if (data.activityLogs.length === 0) return null;
  return (
    <div>
      <SectionLabel>Activity</SectionLabel>
      {data.activityLogs.map(a => {
        // Every one of these already travels in the day-log payload — the row simply never read
        // them, so a 6 km interval walk showed as a title and a number of minutes (Q-247).
        const facts = [
          a.distanceKm != null ? `${a.distanceKm.toFixed(2)} km` : null,
          a.caloriesBurned != null ? `${Math.round(a.caloriesBurned)} kcal` : null,
          a.avgPaceSecPerKm != null ? paceLabel(a.avgPaceSecPerKm) : null,
          a.avgHr != null ? `${Math.round(a.avgHr)} bpm avg` : null,
          a.maxHr != null ? `${Math.round(a.maxHr)} bpm max` : null,
          a.steps != null ? `${a.steps.toLocaleString()} steps` : null,
          a.elevationGainM != null && a.elevationGainM > 0 ? `${Math.round(a.elevationGainM)} m up` : null,
        ].filter((f): f is string => f != null);
        return (
          <div key={a.id} className="mb-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
            <div className="flex items-center gap-2.5">
              <Footprints className="h-4 w-4 flex-none" style={{ color: "var(--accent-green)" }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{a.title}</span>
                {a.startTime && <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">{a.startTime}</span>}
              </span>
              {a.durationMin != null && (
                <span className="flex-none text-[0.9rem] font-bold tabular-nums">{durationLabel(a.durationMin)}</span>
              )}
            </div>
            {facts.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/5 pt-2.5">
                {facts.map(f => (
                  <span key={f} className="text-[11px] tabular-nums text-muted-foreground">{f}</span>
                ))}
              </div>
            )}
            {a.notes && <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{a.notes}</p>}
          </div>
        );
      })}
    </div>
  );
});

/**
 * Calories in vs out for the day. The numbers come from `/api/nutrition/energy-balance`, the same
 * route that powers Nutrition's Energy Balance card — a second computation here would be a second
 * answer to "how much did I burn today", and the day screen disagreeing with Nutrition is worse
 * than either being slightly off (Q-247, "One Formula, One Place").
 */
export const EnergySection = memo(function EnergySection({ energy }: { energy: EnergyBalanceResponse | null }) {
  const summary = energyDaySummary(energy);
  if (!summary) return null;
  return (
    <div>
      <SectionLabel>Energy</SectionLabel>
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
        <div className="flex justify-between">
          <Stat value={summary.intakeKcal.toLocaleString()} label="Eaten" />
          <Stat value={summary.expenditureKcal.toLocaleString()} label="Burned" />
          <Stat
            value={`${summary.netKcal > 0 ? "+" : ""}${summary.netKcal.toLocaleString()}`}
            label={summary.netLabel}
          />
        </div>
        <div className="mt-3 border-t border-white/5 pt-2.5">
          <KeyValues rows={summary.breakdown.map(b => [b.label, `${b.kcal.toLocaleString()} kcal`] as [string, string])} />
        </div>
      </div>
    </div>
  );
});

export const SleepSection = memo(function SleepSection({ sleep, tz }: { sleep: DaySleep | null; tz?: string }) {
  if (!sleep) return null;
  const rows: [string, string][] = [];
  if (sleep.deepSleepHours != null) rows.push(["Deep", hm(sleep.deepSleepHours)]);
  if (sleep.remSleepHours != null) rows.push(["REM", hm(sleep.remSleepHours)]);
  if (sleep.lightSleepHours != null) rows.push(["Light", hm(sleep.lightSleepHours)]);
  if (sleep.awakeHours != null) rows.push(["Awake", hm(sleep.awakeHours)]);
  if (sleep.efficiency != null) rows.push(["Efficiency", `${Math.round(sleep.efficiency)}%`]);
  if (sleep.onsetLatencySec != null) rows.push(["Onset", `${Math.round(sleep.onsetLatencySec / 60)}m`]);
  if (sleep.averageHrvMs != null) rows.push(["Avg HRV", `${Math.round(sleep.averageHrvMs)}ms`]);
  if (sleep.lowestHeartRate != null) rows.push(["Lowest HR", `${sleep.lowestHeartRate}bpm`]);

  return (
    <div>
      <SectionLabel>Sleep</SectionLabel>
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
        <div className="flex items-baseline gap-2 pb-2.5">
          <Moon className="h-4 w-4 flex-none self-center" style={{ color: "var(--accent-purple)" }} />
          {sleep.durationHours != null && (
            <span className="text-[1.7rem] font-light leading-none tabular-nums">{hm(sleep.durationHours)}</span>
          )}
          {sleep.sleepScore != null && (
            <span className="ml-auto flex items-baseline gap-1.5">
              <span className="text-[1.2rem] font-bold leading-none tabular-nums" style={{ color: "var(--accent-purple)" }}>
                {sleep.sleepScore}
              </span>
              <span className="text-[8.5px] uppercase tracking-[0.16em] text-muted-foreground">Score</span>
            </span>
          )}
        </div>
        {sleep.sleepPhase5Min && sleep.sleepStart && sleep.sleepEnd && (
          <>
            <Hypnogram phase5Min={sleep.sleepPhase5Min} sleepStart={sleep.sleepStart} sleepEnd={sleep.sleepEnd} size="sm" />
            <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
              <span>{formatTimeOfDay(sleep.sleepStart, tz)}</span>
              <span>{formatTimeOfDay(sleep.sleepEnd, tz)}</span>
            </div>
          </>
        )}
        {rows.length > 0 && <div className="mt-2.5"><KeyValues rows={rows} /></div>}
      </div>
    </div>
  );
});

export const BodySection = memo(function BodySection({ body }: { body: DayBodyMeta | null }) {
  if (!body) return null;
  const rows: [string, string][] = [];
  const push = (label: string, v: number | null, unit: string, dp = 1) => {
    if (v != null) rows.push([label, `${dp === 0 ? Math.round(v) : v.toFixed(dp)}${unit}`]);
  };
  push("Body fat", body.bodyFat, "%");
  push("Skeletal muscle", body.skeletalMusclePct, "%");
  push("Muscle mass", body.muscleMassKg, "kg");
  push("Body water", body.bodyWaterPct, "%");
  push("Visceral fat", body.visceralFatIndex, "", 0);
  push("Bone mass", body.boneMassKg, "kg");
  push("Protein", body.proteinPct, "%");
  push("BMR", body.bmrKcal, " kcal", 0);
  push("Metabolic age", body.metabolicAge, " yr", 0);
  push("Subcut. fat", body.subcutaneousFatPct, "%");
  push("Fat-free mass", body.fatFreeMassKg, "kg");
  push("Resting HR", body.restingHeartRate, " bpm", 0);
  push("HRV", body.hrvMs, " ms", 0);
  push("SpO₂", body.spo2Pct, "%", 0);
  if (body.steps != null) rows.push(["Steps", body.steps.toLocaleString()]);
  if (body.distanceKm != null) rows.push(["Distance", `${body.distanceKm.toFixed(2)} km`]);

  if (body.weightKg == null && rows.length === 0) return null;

  return (
    <div>
      <SectionLabel>Body composition</SectionLabel>
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
        {body.weightKg != null && (
          <div className="flex items-baseline gap-2 border-b border-white/10 pb-2.5">
            <Scale className="h-4 w-4 flex-none self-center text-muted-foreground" />
            <span className="text-[2.2rem] font-light leading-none tabular-nums">{body.weightKg.toFixed(1)}</span>
            <span className="text-[12px] text-muted-foreground">kg</span>
          </div>
        )}
        {rows.length > 0 && <div className="mt-2"><KeyValues rows={rows} /></div>}
      </div>
    </div>
  );
});

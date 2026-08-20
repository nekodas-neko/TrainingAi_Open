"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrag } from "@use-gesture/react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronLeft, Zap, HeartPulse, Moon, Flame } from "lucide-react";
import { ScreenHeader } from "@/components/shell/screen-header";
import { useTransitionRouter } from "@/lib/view-transition";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { DAY_LOG_TTL, ENERGY_BALANCE_TTL, HR_PROFILE_TTL } from "@trainingai/shared/cache-ttl";
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from "@trainingai/shared/date-utils";
import {
  TrainingSection, ActivitySection, EnergySection, SleepSection, BodySection, DayHrTrace, SectionLabel,
} from "@/components/health/day-detail/day-sections";
import type { DayLogResult } from "@/app/api/day-log/route";
import type { EnergyBalanceResponse } from "@/app/api/nutrition/energy-balance/route";
import type { FoodLogWithItem } from "@trainingai/shared/types/nutrition";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { EnergyTimelineChart } from "@/components/health/energy-timeline-chart";
import { workoutKcalBySession } from "@/components/health/day-detail/energy-summary";

/** Cache key per day — the whole point of this screen is swiping between days, so each day's
 *  payload is seeded synchronously from cache and revalidated, never shown as a skeleton twice. */
const keyFor = (date: string) => `day-log:${date}`;
/** Nutrition's Energy Balance card already owns this key and TTL for the same endpoint — reusing
 *  them means the two screens share one cached answer rather than racing two of their own. */
const energyKeyFor = (date: string) => `energy-balance:${date}`;
/** Q-414. Its own key rather than reusing `day-log:` — the day payload has no meal times. */
const foodKeyFor = (date: string) => `food-logs:${date}`;
/** Module-level so the empty fallback keeps one identity — it feeds a memoised chart. */
const EMPTY_HR: DayLogResult['hr'] = [];

function ScoreCell({ Icon, label, value, accent, first }: {
  Icon: typeof Zap; label: string; value: number | null; accent: string; first: boolean;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center gap-1.5 py-0.5"
      style={first ? undefined : { borderLeft: "1px solid var(--border)" }}
    >
      <Icon className="h-[15px] w-[15px]" style={{ color: accent }} />
      <span className="text-[1.6rem] font-extrabold leading-none tabular-nums tracking-tight">
        {value ?? "—"}
      </span>
      <span className="text-[8.5px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
    </div>
  );
}

/** Seven-day strip. Chosen over bare chevrons because a date alone gives no hint the screen moves
 *  sideways — the strip makes the swipe discoverable and shows where you are in the week. */
function WeekStrip({ selected, onPick, today }: { selected: string; onPick: (d: string) => void; today: string }) {
  const days = useMemo(() => {
    // Monday-first week containing `selected`, derived by string arithmetic so it never crosses a
    // timezone boundary the way a local Date would.
    const dow = (new Date(`${selected}T12:00:00Z`).getUTCDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, i) => shiftDateStr(selected, i - dow));
  }, [selected]);
  const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div className="flex gap-1 px-4">
      {days.map((d, i) => {
        const on = d === selected;
        const future = d > today;
        return (
          <button
            key={d}
            type="button"
            onClick={() => !future && onPick(d)}
            disabled={future}
            aria-label={d}
            aria-current={on ? "date" : undefined}
            className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-xl py-2 transition ${on ? "bg-white/10" : ""} ${future ? "opacity-30" : "active:scale-95"}`}
          >
            <span className="text-[8.5px] tracking-[0.1em] text-muted-foreground">{LETTERS[i]}</span>
            <span className="text-[14px] font-bold tabular-nums">{Number(d.slice(8, 10))}</span>
          </button>
        );
      })}
    </div>
  );
}

export function DayDetailContent({ initialDate, tz }: { initialDate: string; tz?: string }) {
  const router = useTransitionRouter();
  const today = useMemo(() => todayInTz(tz), [tz]);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [data, setData] = useState<DayLogResult | null>(null);
  const [energy, setEnergy] = useState<EnergyBalanceResponse | null>(null);
  const [foodLogs, setFoodLogs] = useState<FoodLogWithItem[] | null>(null);
  const hrProfile = useCachedValue<{ maxHr: number; restingHr: number }>(
    'hr-profile', '/api/hr-profile', HR_PROFILE_TTL,
  );
  // `loggedAt` means when the food was EATEN, not when the row was written — that is Q-413, and it
  // is the whole reason this chart can exist. Before it, every back-filled day spiked at whatever
  // hour the user reached for their phone.
  // Q-391: the per-session addends of the Energy section's "Workouts" row, so a session card and
  // the day total on the same screen cannot disagree — they are the same numbers.
  const kcalBySession = useMemo(() => workoutKcalBySession(energy), [energy]);

  const intakeEvents = useMemo(
    () => (foodLogs ?? []).map(l => ({ atMs: new Date(l.loggedAt).getTime(), kcal: l.calories })),
    [foodLogs],
  );
  const dirRef = useRef(0);
  /** Mirrors selectedDate for the async guard below — a ref, not state, so an in-flight response
   *  reads the CURRENT day rather than the one captured when its fetch started. */
  const dateRef = useRef(initialDate);

  const load = useCallback((date: string) => {
    // Seed synchronously so a day already visited repaints instantly instead of flashing empty.
    const seed = readCacheSync<DayLogResult>(keyFor(date));
    setData(seed ?? null);
    cachedFetch<DayLogResult>(keyFor(date), `/api/day-log?date=${date}`, DAY_LOG_TTL, d => {
      // Guarded on the date rather than applied blind: swiping fast can land a slower response for
      // a day the user has already moved off, which would repaint the wrong day's data.
      setData(prev => (dateRef.current === date ? d : prev));
    }).catch(() => {});

    // Separate call rather than folding energy into /api/day-log: computeEnergyBalance reads a
    // 30-day window to calibrate maintenance, and the day payload is fetched on every swipe.
    setEnergy(readCacheSync<EnergyBalanceResponse>(energyKeyFor(date)) ?? null);
    cachedFetch<EnergyBalanceResponse>(
      energyKeyFor(date), `/api/nutrition/energy-balance?date=${date}`, ENERGY_BALANCE_TTL,
      e => { setEnergy(prev => (dateRef.current === date ? e : prev)); },
    ).catch(() => {});

    // Q-414: the energy chart needs each meal's *time*, which the day payload does not carry —
    // it reports the day's totals. Same date-guard as above.
    setFoodLogs(readCacheSync<FoodLogWithItem[]>(foodKeyFor(date)) ?? null);
    cachedFetch<FoodLogWithItem[]>(
      foodKeyFor(date), `/api/nutrition/food-logs?date=${date}`, DAY_LOG_TTL,
      f => { setFoodLogs(prev => (dateRef.current === date ? f : prev)); },
    ).catch(() => {});
  }, []);

  useEffect(() => { dateRef.current = selectedDate; load(selectedDate); }, [selectedDate, load]);

  const go = useCallback((next: string, dir: number) => {
    if (next > today) return;
    dirRef.current = dir;
    setSelectedDate(next);
  }, [today]);

  // Copies nutrition-content.tsx's binding rather than hand-rolling a third swipe implementation
  // (CLAUDE.md calls the two existing hand-rolled ones out as debt). Same thresholds so the two
  // screens feel identical under the thumb.
  const bindDateSwipe = useDrag(
    ({ movement: [mx], last, velocity: [vx] }) => {
      if (!last) return;
      if (Math.abs(mx) < 60 && vx < 0.5) return;
      if (mx < 0) go(shiftDateStr(selectedDate, 1), 1);
      else if (mx > 0) go(shiftDateStr(selectedDate, -1), -1);
    },
    { axis: "x", filterTaps: true, pointer: { touch: true } },
  );

  const label = useMemo(() => {
    const d = new Date(`${selectedDate}T12:00:00Z`);
    return d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  }, [selectedDate]);

  const s = data?.scores;
  const hasAnything = !!data && (
    data.exercises.length > 0 || data.activityLogs.length > 0 || !!data.sleep || !!data.bodyMeta || data.hr.length > 0
  );

  return (
    <div className="flex flex-col bg-page pb-nav-safe" style={{ height: "100dvh" }}>
      <ScreenHeader bordered={false}>
        <div className="flex w-full items-center gap-1">
          {/* This route sits outside the tab shell, so it renders no bottom nav — without an
              explicit back control the calendar tap is a one-way trip. */}
          <button
            type="button"
            aria-label="Back"
            onClick={() => router.back()}
            className="flex h-12 w-12 flex-none items-center justify-center rounded-xl text-muted-foreground transition active:scale-95"
          >
            <ChevronLeft className="h-[22px] w-[22px]" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-extrabold tracking-tight">{label}</h1>
          {/* Day navigation is the week strip below plus the swipe; a second pair of chevrons up
              here would sit next to the back chevron pointing the same way and mean something
              different. A spacer keeps the title optically centred instead. */}
          <span className="h-12 w-12 flex-none" aria-hidden />
        </div>
      </ScreenHeader>

      <div className="flex-none pb-2">
        <WeekStrip selected={selectedDate} onPick={d => go(d, d > selectedDate ? 1 : -1)} today={today} />
      </div>

      <div className="flex-none border-b border-border px-4 pb-3">
        <div className="flex">
          <ScoreCell Icon={Zap} label="Ready" value={s?.readiness ?? null} accent="#60a5fa" first />
          <ScoreCell Icon={HeartPulse} label="HR" value={data?.bodyMeta?.restingHeartRate ?? null} accent="#f87171" first={false} />
          <ScoreCell Icon={Moon} label="Sleep" value={s?.sleep ?? data?.sleep?.sleepScore ?? null} accent="#a78bfa" first={false} />
          <ScoreCell Icon={Flame} label="Move" value={s?.activity ?? null} accent="#f97316" first={false} />
        </div>
      </div>

      {/* touchAction pan-y so the vertical scroll still belongs to the browser while the horizontal
          axis is ours — the direction-lock rule, satisfied by the platform rather than by hand. */}
      <div
        {...bindDateSwipe()}
        data-swipe-carousel
        style={{ touchAction: "pan-y" }}
        className="flex-1 space-y-4 overflow-y-auto scrollbar-hide px-4 pt-4"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={selectedDate}
            initial={{ opacity: 0, x: dirRef.current * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="space-y-4"
          >
            {data && <TrainingSection data={data} kcalBySession={kcalBySession} />}
            {data && <ActivitySection data={data} />}
            <EnergySection energy={energy} />
            {energy?.balance && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                <EnergyTimelineChart
                  dayStartMs={dateStrMidnightInTz(selectedDate, tz).getTime()}
                  restingHr={hrProfile?.restingHr ?? null}
                  restingBaseKcal={energy.balance.restingBaseKcal}
                  activeKcal={energy.balance.activeKcal}
                  hr={data?.hr ?? EMPTY_HR}
                  intake={intakeEvents}
                />
              </div>
            )}
            <SleepSection sleep={data?.sleep ?? null} tz={tz} />
            {data && data.hr.length > 1 && (
              <div>
                <SectionLabel>Heart rate through the day</SectionLabel>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                  <DayHrTrace points={data.hr} />
                </div>
              </div>
            )}
            <BodySection body={data?.bodyMeta ?? null} />
            {data && !hasAnything && (
              <p className="py-16 text-center text-sm text-muted-foreground">Nothing logged on this day.</p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

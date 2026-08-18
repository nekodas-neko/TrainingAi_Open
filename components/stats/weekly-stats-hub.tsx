"use client";

import type { WeeklyStatsResponse } from "@/app/api/weekly-stats/route";
import { getPaletteEntry } from "@trainingai/shared/session-palette";
import type { ProgramSession } from "@trainingai/shared/types/program";
import { localDateString, shortSessionName } from "@trainingai/shared/utils";
import { useCountUp } from "@/lib/hooks/use-count-up";

// Diagonal stripe cut out of a bar. A mask uses only the gradient's alpha, so `currentColor` (any
// opaque value) does the job — no colour literal, and nothing that can break in light mode the way
// a black/white-alpha overlay would.
const STRIPE_GRADIENT = "repeating-linear-gradient(45deg, currentColor 0 3px, transparent 3px 6px)";
const STRIPE_MASK = { maskImage: STRIPE_GRADIENT, WebkitMaskImage: STRIPE_GRADIENT } as const;

interface WeeklyStatsHubProps {
  data: WeeklyStatsResponse | null;
  loading: boolean;
  sessions?: ProgramSession[];
}

// Leaf component owning its own useCountUp tick (PERF-8) — hoisting the count-up
// state to the hub top re-rendered the whole hub (day-volume bars + all four stat
// cards) on every animation frame; only this number should animate.
function CountUpValue({ target, fallback }: { target: number | null; fallback: number }) {
  const value = useCountUp(target);
  return <>{value != null ? Math.round(value) : fallback}</>;
}

export function WeeklyStatsHub({ data, loading, sessions = [] }: WeeklyStatsHubProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-14 animate-pulse rounded-2xl bg-muted" />)}
      </div>
    );
  }

  if (!data) return null;

  // name (lowercase) → palette position
  const nameToPos = new Map(sessions.map(s => [s.name.toLowerCase(), s.position]));
  const todayKey = localDateString();

  // Deload days now draw from `deloadVolume`, so they have to scale against it too — otherwise a
  // week of nothing but deloads leaves maxVolume at the 1 floor and the bar runs off the chart.
  const maxVolume = Math.max(1, ...data.days.map(d => Math.max(d.volume, d.deloadVolume)));

  const STAT_CARDS = [
    { label: "Sessions",     value: <CountUpValue target={data.totalSessions} fallback={data.totalSessions} />, unit: "this week"  },
    { label: "Sets",         value: <CountUpValue target={data.totalSets} fallback={data.totalSets} />,          unit: "logged"     },
    { label: "Volume",       value: data.totalVolumeKg > 0 ? `${data.totalVolumeKg.toLocaleString()} kg` : "—", unit: "total lifted" },
    { label: "Avg Duration", value: data.avgDurationMin != null ? `${data.avgDurationMin}m` : "—",          unit: "per session" },
  ];

  return (
    // One cohesive "This Week" unit: the per-day load bars and the headline stats live in
    // a single card (divided), instead of two separate stacked cards.
    <div className="rounded-2xl bg-muted/60 border border-border p-4">
      {/* Training Load Bars */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Training Load</p>
        {/* min-h, not a fixed h-14: the columns were ALREADY taller than 56 px with no flag at
              all (52 bar + 4 gap + ~13.5 label = 69.5), so they overflowed upward and the tallest
              bar collided with the heading above. Inlining the flags removed the difference between
              columns; this removes the overflow itself. min-h keeps the row a stable height across
              weeks so the card does not resize as data changes. */}
          <div className="flex items-end gap-1 min-h-[72px]">
          {data.days.map((day) => {
            // A deload/testing day's volume is held out of `volume` so it can't inflate the weekly
            // total — but the day was still trained, so the bar draws from that held-out figure
            // rather than collapsing to the grey "no data" sliver a rest day gets (Q-246). Striped
            // rather than solid so it stays visually distinct from a full session.
            const barVolume = day.volume > 0 ? day.volume : day.deloadVolume;
            const isReduced = day.volume === 0 && day.deloadVolume > 0;
            const hasData = barVolume > 0;
            const totalHeight = hasData ? Math.max(16, (barVolume / maxVolume) * 52) : 6;
            const isToday = day.dateKey === todayKey;
            const isEmpty = !hasData;
            const kg = `${Math.round(barVolume).toLocaleString()} kg`;

            return (
              <div key={day.dateKey} className="flex flex-1 flex-col items-center gap-1" title={hasData ? (isReduced ? `${kg} · ${day.isTesting ? "testing" : "deload"}` : kg) : undefined}>
                <div className="w-full flex flex-col-reverse rounded-t-md overflow-hidden" style={{ height: totalHeight }}>
                  {isEmpty ? (
                    <div className="w-full h-full bg-muted-foreground/20" />
                  ) : (
                    day.sessions.map((name) => {
                      const pos = nameToPos.has(name.toLowerCase())
                        ? nameToPos.get(name.toLowerCase())!
                        : name.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
                      const { dotClass } = getPaletteEntry(pos);
                      return (
                        <div
                          key={name}
                          className={`w-full flex-1 ${dotClass}`}
                          // The stripes are cut out of the bar with an alpha-only mask, so the card
                          // behind shows through — no literal colour, nothing to break in light mode.
                          style={isReduced ? { opacity: 0.85, ...STRIPE_MASK } : { opacity: 0.85 }}
                        />
                      );
                    })
                  )}
                </div>
                {/* The flags are INLINE in the label, not siblings of it (Q-390). As separate
                    children of this column flex each one became an extra ROW, so a flagged day's
                    column grew ~12 px taller than an unflagged one — and since the row is
                    `items-end`, that pushed its bar up off the shared baseline. On a chart whose
                    only job is comparing days against each other, two identical volumes rendered at
                    visibly different heights. They stay coloured *and* lettered: the glyph is the
                    non-colour channel the colour-only-state rule needs, so a coloured dot would not
                    do. */}
                <span className={`text-[9px] font-medium ${isToday ? "text-brand font-bold" : "text-muted-foreground"}`}>
                  {day.label}
                  {(day.isDeload || day.isTesting) && (
                    <>
                      {" ("}
                      {day.isDeload && <span className="font-bold text-amber-500">D</span>}
                      {/* Both flags can be true at once — they are independent fields, so this had
                          to have a defined combined form rather than being met for the first time on
                          a testing week. "Mon (D·T)" is 9 characters in a ~51 dp column at the S25
                          viewport, which fits; a separator wider than the interpunct would not. */}
                      {day.isDeload && day.isTesting && "·"}
                      {day.isTesting && <span className="font-bold text-purple-500">T</span>}
                      {")"}
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        {sessions.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 pt-2 border-t border-border/50">
            {sessions.map(s => {
              const { dotClass, textClass } = getPaletteEntry(s.position);
              return (
                <div key={s.id} className="flex items-center gap-1">
                  <div className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
                  <span className={`text-[10px] font-medium ${textClass}`}>{shortSessionName(s.name)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Headline stats — a footer strip in the same card, divided from the bars above */}
      <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-border/50">
        {STAT_CARDS.map(card => (
          <div key={card.label} className="text-center">
            <p className="text-xl font-bold tabular-nums leading-tight" style={{ color: "var(--color-brand)" }}>
              {card.value}
            </p>
            <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground mt-0.5">{card.label}</p>
            <p className="text-[8px] text-muted-foreground leading-tight">{card.unit}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

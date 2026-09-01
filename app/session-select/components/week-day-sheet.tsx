'use client'

import { useEffect, useState } from "react"
import { MoonStarIcon, WeightIcon, FootprintsIcon, FlameIcon, BeefIcon, BarChart3Icon, type LucideIcon } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache"
import { DAY_LOG_TTL } from "@trainingai/shared/cache-ttl"
import type { DayLogResult, DayExercise } from "@/app/api/day-log/route"
import { displayBodyFat } from "@/components/health/body-fat-display"

function formatOverlayDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("/").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" })
}

interface WeekDaySheetProps {
  date: string | null
  onClose: () => void
  onExerciseTap: (name: string) => void
}

export function WeekDaySheet({ date, onClose, onExerciseTap }: WeekDaySheetProps) {
  const [data, setData] = useState<DayLogResult | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!date) return
    let cancelled = false
    // Seed from cache before the fetch so re-opening a day paints its contents
    // on the first frame instead of a spinner. A miss falls through to the
    // spinner exactly as before.
    const seeded = readCacheSync<DayLogResult>(`day-log:${date}`)
    setData(seeded)
    setLoading(seeded === null)
    cachedFetch<DayLogResult>(
      `day-log:${date}`, `/api/day-log?date=${encodeURIComponent(date)}`, DAY_LOG_TTL,
      (d) => { if (!cancelled) { setData(d); setLoading(false) } },
    ).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date])

  return (
    <Sheet open={date !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{date ? formatOverlayDate(date) : ""}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-brand)", borderTopColor: "transparent" }} />
            </div>
          ) : (() => {
            const exercises = data?.exercises ?? [];
            const bodyMeta = data?.bodyMeta ?? null;
            const workoutDurationsById = data?.workoutDurationsById ?? {};

            // Grouped by session **id**, not name (Q-362b). Two `Push` sessions in one day are two
            // workouts; keying on the name merged them into one block under one duration chip.
            const sessionGroups = new Map<string, { name: string; exercises: DayExercise[] }>();
            for (const ex of exercises) {
              const group = sessionGroups.get(ex.workoutSessionId) ?? { name: ex.sessionName, exercises: [] };
              group.exercises.push(ex);
              sessionGroups.set(ex.workoutSessionId, group);
            }
            const hasContent = sessionGroups.size > 0 || bodyMeta !== null;

            if (!hasContent) {
              return (
                <div className="flex flex-col items-center gap-2 py-8">
                  <MoonStarIcon className="w-9 h-9 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Rest day</p>
                </div>
              );
            }

            const metaChips = [
              bodyMeta?.weightKg != null   && { Icon: WeightIcon,      text: `${bodyMeta.weightKg}kg` },
              bodyMeta?.steps != null      && { Icon: FootprintsIcon,  text: bodyMeta.steps.toLocaleString() },
              bodyMeta?.calories != null   && { Icon: FlameIcon,       text: `${bodyMeta.calories} kcal` },
              bodyMeta?.protein != null    && { Icon: BeefIcon,        text: `${bodyMeta.protein}g` },
              displayBodyFat(bodyMeta) != null && { Icon: BarChart3Icon, text: `${displayBodyFat(bodyMeta)}% BF` },
            ].filter((v): v is { Icon: LucideIcon; text: string } => Boolean(v));

            return (
              <>
                {metaChips.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {metaChips.map(({ Icon, text }) => (
                      <span key={text} className="flex items-center gap-1 text-[11px] rounded-full bg-muted border border-border px-3 py-1 font-medium">
                        <Icon className="w-3 h-3" /> {text}
                      </span>
                    ))}
                  </div>
                )}
                {[...sessionGroups.entries()].map(([sessionId, { name: sessionName, exercises: exs }]) => {
                  const dur = workoutDurationsById[sessionId];
                  return (
                    <div key={sessionId} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{sessionName}</p>
                        {dur && (
                          <span className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground border border-border">
                            {dur.minutes}m
                          </span>
                        )}
                      </div>
                      <div className="space-y-1">
                        {exs.map((ex) => (
                          <button
                            key={ex.exerciseLogId}
                            onClick={() => onExerciseTap(ex.name)}
                            className="w-full flex items-baseline justify-between gap-2 py-0.5 active:opacity-60 transition-opacity text-left"
                          >
                            <p className="text-sm font-medium truncate flex-1">{ex.name}</p>
                            <p className="text-[11px] text-muted-foreground text-right flex-none tabular-nums">
                              {ex.setWeights.length > 0
                                ? `${ex.setWeights[0]}kg × ${ex.reps.join(", ")}`
                                : ex.sets != null ? `${ex.sets} sets` : ""}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>
      </SheetContent>
    </Sheet>
  )
}

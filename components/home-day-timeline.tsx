"use client";

import { Fragment, memo } from "react";
import {
  Sunrise, Moon, Dumbbell, Footprints, Utensils,
  BedDouble, Flame, Clock, Zap, Tag,
  type LucideIcon,
} from "lucide-react";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { TTL_SHORT } from "@trainingai/shared/cache-ttl";
import type { TimelineEvent } from "@/app/api/day-timeline/route";
import { useTransitionRouter } from "@/lib/view-transition";

const ICON_MAP: Record<string, LucideIcon> = {
  Sunrise, Moon, Dumbbell, Footprints, Utensils, BedDouble, Tag,
};

const TYPE_BG: Record<string, string> = {
  wakeup:  "bg-indigo-500/20 border-indigo-500/40",
  sleep:   "bg-indigo-500/20 border-indigo-500/40",
  workout: "bg-brand/20 border-brand/40",
  walk:    "bg-blue-500/20 border-blue-500/40",
  meal:    "bg-orange-500/20 border-orange-500/40",
  bedtime: "bg-indigo-500/20 border-indigo-500/40",
  tag:     "bg-muted border-border/60",
};

const TYPE_ICON_COLOR: Record<string, string> = {
  wakeup:  "text-indigo-400",
  sleep:   "text-indigo-400",
  workout: "text-brand",
  walk:    "text-blue-400",
  meal:    "text-orange-400",
  bedtime: "text-indigo-400",
  tag:     "text-muted-foreground",
};

function fmt(h: number): string {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function WakeupCard({ ev }: { ev: TimelineEvent }) {
  return (
    <div className="flex-1 rounded-xl border border-border/60 bg-muted/40 p-3 space-y-2">
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-semibold">{ev.title}</p>
        <p className="text-sm font-bold text-foreground">{ev.time}</p>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {ev.sleepDurationH != null && (
          <span className="flex items-center gap-1">
            <BedDouble className="h-3 w-3" />
            {fmt(ev.sleepDurationH)}
          </span>
        )}
        {ev.readinessScore != null && (
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3 text-green-400" />
            <span className="text-foreground font-medium">{ev.readinessScore}</span>
          </span>
        )}
        {ev.sleepScore != null && (
          <span className="flex items-center gap-1">
            <Moon className="h-3 w-3 text-indigo-400" />
            <span className="text-foreground font-medium">{ev.sleepScore}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function WorkoutCard({ ev }: { ev: TimelineEvent }) {
  return (
    <div className="flex-1 rounded-xl border border-border/60 bg-muted/40 p-3 space-y-2">
      <p className="text-sm font-semibold">{ev.title}</p>
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {ev.durationMin != null && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {ev.durationMin} min
          </span>
        )}
        {ev.sets != null && (
          <span className="flex items-center gap-1">
            <Dumbbell className="h-3 w-3" />
            {ev.sets} sets
          </span>
        )}
        {ev.exerciseCount != null && (
          <span>{ev.exerciseCount} exercises</span>
        )}
      </div>
    </div>
  );
}

function WalkCard({ ev }: { ev: TimelineEvent }) {
  const label = ev.title === "Run" ? "Outdoor running" : ev.title === "Walk" ? "Outdoor walking" : ev.title;
  return (
    <div className="flex-1 rounded-xl border border-border/60 bg-muted/40 p-3 space-y-2">
      <p className="text-sm font-semibold">
        {label}{ev.distanceKm != null ? ` / ${ev.distanceKm} km` : ""}
      </p>
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {ev.durationMin != null && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {ev.durationMin} min
          </span>
        )}
        {ev.calories != null && (
          <span className="flex items-center gap-1">
            <Flame className="h-3 w-3" />
            {ev.calories} Cal
          </span>
        )}
      </div>
    </div>
  );
}

function MealCard({ ev }: { ev: TimelineEvent }) {
  // subtitle format: "456 kcal · 6 AM – 9 AM" or just "6 AM – 9 AM"
  const parts = ev.subtitle?.split(' · ') ?? []
  const calStr = parts.length === 2 ? parts[0] : null
  const windowStr = parts.length === 2 ? parts[1] : parts[0]
  return (
    <div className="flex-1 rounded-xl border border-border/60 bg-muted/40 p-3 space-y-1.5">
      <p className="text-sm font-semibold">{ev.title}</p>
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {calStr && <span className="flex items-center gap-1"><Flame className="h-3 w-3" />{calStr}</span>}
        {windowStr && <span>{windowStr}</span>}
      </div>
    </div>
  );
}

function BedtimeCard({ ev }: { ev: TimelineEvent }) {
  return (
    <div className="flex-1 rounded-xl border border-border/60 bg-muted/40 p-3">
      <p className="text-sm font-semibold">{ev.title}</p>
    </div>
  );
}

function SleepCard({ ev }: { ev: TimelineEvent }) {
  return (
    <div className="flex-1 rounded-xl border border-border/60 bg-muted/40 p-3 space-y-1.5">
      <p className="text-sm font-semibold">{ev.title}</p>
      {ev.subtitle && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {ev.subtitle}
        </div>
      )}
    </div>
  );
}

function TagCard({ ev }: { ev: TimelineEvent }) {
  return (
    <div className="flex-1 rounded-xl border border-border/60 bg-muted/40 p-3 space-y-1.5">
      <p className="text-sm font-semibold">{ev.title}</p>
      {ev.subtitle && <p className="text-xs text-muted-foreground">{ev.subtitle}</p>}
    </div>
  );
}

function EventRow({ ev, isLast }: { ev: TimelineEvent; isLast: boolean; isFirst?: boolean }) {
  const router = useTransitionRouter();
  const Icon = ICON_MAP[ev.icon] ?? Sunrise;
  const bgClass = TYPE_BG[ev.type] ?? "bg-muted border-border/60";
  const iconColor = TYPE_ICON_COLOR[ev.type] ?? "text-muted-foreground";

  // Q-93: the meal card jumps to the nutrition screen for that date. Q-93-followup: "Woke up"/
  // "Fell asleep" jump to the Health tab's Sleep detail sheet pre-opened to that night, reusing
  // its existing per-night detail view (HealthMetricSheet's SleepDetailView) rather than building
  // a new screen — the sheet already renders full per-night detail for any of the last 14 nights,
  // it just needed a way to be told which one to open with. The workout and walk cards land on
  // `/health/day`, which Q-110 built after this entry was written: its Training section renders
  // each session's exercises, sets, duration, volume and kcal, and its Activity section opens
  // ActivityDetailSheet. `bedtime` is a projection and `tag` a marker — neither has a detail view
  // to reach, so both stay inert.
  let onTap: (() => void) | undefined;
  if (ev.date && ev.type === "meal") {
    onTap = () => router.push(`/nutrition?date=${ev.date}`);
  } else if (ev.date && (ev.type === "wakeup" || ev.type === "sleep")) {
    onTap = () => router.push(`/health?tab=body&openSleepDate=${ev.date}`);
  } else if (ev.date && (ev.type === "workout" || ev.type === "walk")) {
    onTap = () => router.push(`/health/day?date=${ev.date}`);
  }

  return (
    <div className="flex gap-3">
      {/* Timeline spine */}
      <div className="flex flex-col items-center" style={{ width: 40, flexShrink: 0 }}>
        <div className={`w-9 h-9 rounded-full border flex items-center justify-center ${bgClass}`}>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
        {!isLast && <div className="flex-1 w-px bg-border/50 my-1" />}
      </div>

      {/* Content */}
      <div
        className={`flex-1 pb-4${onTap ? " active:opacity-70 transition-opacity cursor-pointer" : ""}`}
        {...(onTap ? {
          role: "button" as const,
          tabIndex: 0,
          onClick: onTap,
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } },
        } : {})}
      >
        {ev.type !== "wakeup" && (
          <p className="text-[11px] text-muted-foreground mb-1.5">
            {ev.endTime ? `${ev.time} – ${ev.endTime}` : ev.time}
          </p>
        )}
        {ev.type === "wakeup"  && <WakeupCard ev={ev} />}
        {ev.type === "sleep"   && <SleepCard ev={ev} />}
        {ev.type === "workout" && <WorkoutCard ev={ev} />}
        {ev.type === "walk"    && <WalkCard ev={ev} />}
        {ev.type === "meal"    && <MealCard ev={ev} />}
        {ev.type === "bedtime" && <BedtimeCard ev={ev} />}
        {ev.type === "tag"     && <TagCard ev={ev} />}
      </div>
    </div>
  );
}

function HomeDayTimelineComponent() {
  // `today: true` because 'home-day-timeline' is a date-less today key — one canonical variant per
  // key, and `sync-provider`'s warm list agrees.
  const payload = useCachedValue<{ events: TimelineEvent[] }>(
    "home-day-timeline", "/api/day-timeline", TTL_SHORT, { today: true },
  );
  const events = payload?.events ?? null;

  // **The `ta:oura-ble-synced` listener that used to sit here is gone, and that is the point of the
  // conversion.** Q-91 added it because this widget, mounted in the shell, never learned to refetch
  // after a BLE drain invalidated its entry — a just-synced night kept showing the pre-sync bed/wake
  // time. That is Q-402's bug with a hand-built workaround for one event. `useCachedValue` refetches
  // on the invalidation itself, which covers every writer rather than the one that thought to
  // dispatch. Safe to drop because both dispatch sites call `invalidateOuraSync()` immediately
  // before the event, and `lib/__tests__/cache-groups.test.ts` asserts that group clears this key —
  // so the dependency this now leans on is guarded, not assumed.

  if (!events) return null;
  if (events.length === 0) return null;

  const firstYesterdayIdx = events.findIndex(e => e.day === "yesterday");

  return (
    // A named region, so the timeline is addressable rather than positional: the workout card's
    // title is the session name, which Home also renders as a session chip further up the page —
    // a locator that only knows the text finds both.
    <section aria-labelledby="day-timeline-heading" className="mx-4 mb-3">
      <p id="day-timeline-heading" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Today&apos;s Timeline
      </p>
      <div>
        {events.map((ev, i) => (
          <Fragment key={`${ev.type}-${ev.timeMs}`}>
            {i === firstYesterdayIdx && firstYesterdayIdx > 0 && (
              <div className="mb-3 mt-2 flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-foreground">Yesterday</span>
                <span className="h-px flex-1 bg-border/60" />
              </div>
            )}
            <EventRow ev={ev} isLast={i === events.length - 1} isFirst={i === 0} />
          </Fragment>
        ))}
      </div>
    </section>
  );
}

export const HomeDayTimeline = memo(HomeDayTimelineComponent);

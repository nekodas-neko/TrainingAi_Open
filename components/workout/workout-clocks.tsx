"use client";

import { useElapsedSec } from "./session-clock";
import { formatTime } from "./utils";
import { RestRing } from "./rest-ring";

/**
 * Leaf components for everything on the active-workout screen that ticks.
 *
 * The screen used to call useElapsedSec twice at its own top, so two 1 Hz intervals
 * re-reconciled ~700 lines of JSX every second for the length of a session. Each
 * component here owns its own tick and renders only the few nodes that change, which is
 * the placement CLAUDE.md's render-discipline rule asks for.
 */

/** Header session ring: elapsed time in a 60-minute progress ring. Hidden until it ticks. */
export function SessionRing({ startMs }: { startMs: number | null }) {
  const elapsed = useElapsedSec(startMs);
  if (elapsed <= 0) return null;
  const FULL_SEC = 60 * 60;
  const progress = Math.min(1, elapsed / FULL_SEC);
  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ - circ * progress;
  return (
    <div className="relative flex items-center justify-center w-12 h-12 flex-none">
      <svg className="absolute inset-0" width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor"
          strokeOpacity="0.12" strokeWidth="2.5" />
        <circle cx="24" cy="24" r={r} fill="none"
          stroke="var(--color-brand)" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          transform="rotate(-90 24 24)"
          style={{ filter: "drop-shadow(0 0 3px var(--color-brand))",
                   transition: "stroke-dashoffset 1s linear" }} />
      </svg>
      <span className="relative text-[11px] font-bold tabular-nums font-mono leading-none"
        style={{ color: "var(--color-brand)" }}>
        {formatTime(elapsed)}
      </span>
    </div>
  );
}

/** Ready-screen session pill. Hidden until it ticks, same as the header ring. */
export function SessionPill({ startMs }: { startMs: number | null }) {
  const elapsed = useElapsedSec(startMs);
  if (elapsed <= 0) return null;
  return (
    <div
      className="rounded-xl px-3 py-1 font-mono font-black text-base tabular-nums"
      style={{ color: "var(--color-brand)", background: "color-mix(in oklch, var(--color-brand) 10%, transparent)" }}
    >
      {formatTime(elapsed)}
    </div>
  );
}

/** Per-exercise elapsed time in the header subtitle, rendered with its leading separator. */
export function ExerciseClock({ startMs }: { startMs: number | null }) {
  const elapsed = useElapsedSec(startMs);
  return <> · {formatTime(elapsed)}</>;
}

/**
 * Warm-up ramp segments. Derives its own progress from the session clock minus the baseline
 * captured when the ready screen opened, so the parent no longer needs the session tick to
 * drive it. Markup is unchanged from where this lived inline.
 */
export function WarmupRampProgress({
  startMs,
  baselineSec,
  sectionSec,
  warmupSets,
}: {
  startMs: number | null;
  baselineSec: number | null;
  sectionSec: number;
  warmupSets: Array<{ pct: number; reps: number; label: string; weight: number }>;
}) {
  const sessionElapsed = useElapsedSec(startMs);
  const readyElapsedSec = baselineSec != null ? Math.max(0, sessionElapsed - baselineSec) : 0;
  const count = warmupSets.length;
  const allWarmupDone = count > 0 && readyElapsedSec >= count * sectionSec;
  const activeWarmupSection = allWarmupDone ? count : Math.floor(readyElapsedSec / sectionSec);
  const warmupSectionProgress = (readyElapsedSec % sectionSec) / sectionSec;
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
          Warm-up ramp-up
        </p>
        <p className="text-[10px] font-mono tabular-nums text-muted-foreground">
          {formatTime(Math.min(readyElapsedSec, count * sectionSec))} / {formatTime(count * sectionSec)}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {warmupSets.map((w, i) => {
          const isDone = i < activeWarmupSection;
          const isActive = i === activeWarmupSection && !allWarmupDone;
          const fillPct = isDone ? 100 : isActive ? warmupSectionProgress * 100 : 0;
          return (
            <div
              key={i}
              className="relative rounded-xl overflow-hidden border px-2 py-2.5 text-center"
              style={{
                borderColor: isDone
                  ? "rgba(34,197,94,0.3)"
                  : isActive
                    ? "color-mix(in oklch, var(--color-brand) 30%, transparent)"
                    : "var(--color-border)",
                background: isDone
                  ? "rgba(34,197,94,0.07)"
                  : "color-mix(in oklch, var(--color-muted) 40%, transparent)",
              }}
            >
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${fillPct}%`,
                  background: isDone
                    ? "rgba(34,197,94,0.12)"
                    : "color-mix(in oklch, var(--color-brand) 12%, transparent)",
                  transition: isActive ? "width 1s linear" : "none",
                }}
              />
              <div className="relative">
                <p
                  className="text-[9px] font-bold uppercase tracking-wide mb-1"
                  style={{ color: isDone ? "#22c55e" : isActive ? "var(--color-brand)" : "var(--color-muted-foreground)" }}
                >
                  {isDone ? "✓" : `W${i + 1}`} · {w.label}
                </p>
                <p
                  className="text-sm font-black tabular-nums leading-tight"
                  style={{ color: isDone ? "#22c55e" : isActive ? "var(--color-brand)" : "var(--color-muted-foreground)" }}
                >
                  {w.weight} kg
                </p>
                <p className="text-[9px] text-muted-foreground mt-0.5">× {w.reps} · {w.pct}%</p>
              </div>
            </div>
          );
        })}
      </div>
      {allWarmupDone && (
        <p className="text-center text-[10px] font-semibold text-green-500 mt-1.5">✓ Warm-up complete — ready to go!</p>
      )}
    </div>
  );
}

/**
 * Rest countdown. Owns the tick that the whole screen used to carry: the parent previously
 * recomputed restElapsedSec from Date.now() on every render, which only stayed current
 * because the session clock was re-rendering the screen once a second.
 *
 * `onStartSet` makes the ring a tap-to-skip button; without it the ring is inert, which is
 * the all-sets-done state (there is no next set to skip to).
 */
export function RestTimer({
  restStartMs,
  currentRestSec,
  onStartSet,
}: {
  restStartMs: number | null;
  currentRestSec: number;
  onStartSet?: () => void;
}) {
  const elapsed = useElapsedSec(restStartMs);
  const restElapsedSec = restStartMs != null ? elapsed : 0;
  const restProgress = currentRestSec > 0 ? Math.min(1, restElapsedSec / currentRestSec) : 0;
  const restRemaining = Math.max(0, currentRestSec - restElapsedSec);
  const isRestOvertime = restElapsedSec > currentRestSec;
  const overtimeSec = isRestOvertime ? restElapsedSec - currentRestSec : 0;
  const ring = (
    <RestRing
      restProgress={restProgress}
      restRemaining={restRemaining}
      currentRestSec={currentRestSec}
      isRestOvertime={isRestOvertime}
      overtimeSec={overtimeSec}
    />
  );
  const labelColor = isRestOvertime ? "#ef4444" : "var(--color-muted-foreground)";
  return (
    <>
      <p
        className={onStartSet ? "text-[10px] font-bold uppercase tracking-widest mb-3" : "text-[10px] font-bold uppercase tracking-widest"}
        style={{ color: labelColor }}
      >
        {isRestOvertime ? "Overtime" : "Rest"}
      </p>
      {onStartSet ? (
        <button
          onClick={onStartSet}
          aria-label={isRestOvertime ? `${overtimeSec}s overtime — tap to start` : `${restRemaining} seconds remaining — tap to skip`}
          className="relative flex items-center justify-center group"
        >
          {ring}
        </button>
      ) : (
        <div className="relative flex items-center justify-center">{ring}</div>
      )}
      {onStartSet && (
        <p className="text-xs mt-3 opacity-60" style={{ color: labelColor }}>
          {isRestOvertime ? "Rest complete · Tap to start" : "Tap to start early"}
        </p>
      )}
    </>
  );
}

"use client";

// Rest countdown ring — the SVG progress ring shown during the rest phase and
// on the all-sets-done screen. Pure visual: the caller decides whether to wrap
// it in a tap-to-skip button (rest phase) or a plain div (done state).
export function RestRing({
  restProgress,
  restRemaining,
  currentRestSec,
  isRestOvertime,
  overtimeSec,
}: {
  restProgress: number;
  restRemaining: number;
  currentRestSec: number;
  isRestOvertime: boolean;
  overtimeSec: number;
}) {
  const r = 78;
  const circ = 2 * Math.PI * r;
  return (
    <>
      <div
        className="absolute inset-0 rounded-full blur-3xl opacity-20 transition-opacity group-active:opacity-35"
        style={{ background: isRestOvertime ? "#ef4444" : "var(--color-brand)" }}
      />
      <svg width="180" height="180" viewBox="0 0 180 180" className="relative">
        <circle cx="90" cy="90" r={r} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="13" />
        <circle
          cx="90" cy="90" r={r}
          fill="none"
          stroke={isRestOvertime ? "#ef4444" : "var(--color-brand)"}
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${circ * restProgress} ${circ}`}
          transform="rotate(-90 90 90)"
          style={{ filter: isRestOvertime ? "drop-shadow(0 0 10px #ef4444)" : "drop-shadow(0 0 10px var(--color-brand))" }}
        />
        {/* Overtime arc — grows clockwise from top as overtime accumulates */}
        {isRestOvertime && (
          <circle
            cx="90" cy="90" r={r}
            fill="none"
            stroke="#ef4444"
            strokeWidth="13"
            strokeLinecap="round"
            strokeDasharray={`${Math.min(circ, circ * (overtimeSec / currentRestSec))} ${circ}`}
            transform="rotate(-90 90 90)"
            strokeOpacity="0.35"
            style={{ filter: "drop-shadow(0 0 6px #ef4444)" }}
          />
        )}
      </svg>
      <div className="absolute text-center pointer-events-none">
        <p
          className="font-black tabular-nums leading-none"
          style={{
            fontSize: isRestOvertime ? "44px" : "56px",
            color: isRestOvertime ? "#ef4444" : "var(--color-brand)",
          }}
        >
          {isRestOvertime ? `+${overtimeSec}` : restRemaining}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {isRestOvertime ? `target ${currentRestSec}s` : `of ${currentRestSec}s`}
        </p>
      </div>
    </>
  );
}

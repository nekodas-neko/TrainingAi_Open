"use client";

import type { MuscleRecoveryEntry } from "@/app/api/muscle-recovery/route";
import { recoveryBand } from "@trainingai/shared/health/recovery-band";

interface MuscleRecoveryCardProps {
  muscles: MuscleRecoveryEntry[];
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }

function Chip({ muscle, pct }: { muscle: string; pct: number }) {
  const color = recoveryBand(pct).color;
  return (
    <div
      className="flex-none flex items-center gap-1.5 rounded-lg px-2.5 py-1"
      style={{ background: `color-mix(in oklch, ${color} 10%, transparent)`, border: `1px solid color-mix(in oklch, ${color} 30%, transparent)` }}
    >
      <span className="text-[10px] font-bold tabular-nums" style={{ color }}>{pct}%</span>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{capitalize(muscle)}</span>
    </div>
  );
}

/** Recovery chips for the session's main muscle groups — a single-line scrolling marquee.
 *
 *  It briefly became a wrapping row and that was wrong twice over. It cost the card a second line
 *  (~31dp) which it had no slack for: the muscle diagram's SVGs are width-driven, so they could not
 *  shrink to compensate and instead overflowed upward into the session header, colliding the
 *  last-trained date with the FRONT label. And the owner wants it scrolling. A marquee is one line
 *  by construction, so restoring it is also what keeps the card's layout intact — the two are the
 *  same fix.
 *
 *  What the wrap was solving is still real and is handled separately: `prefers-reduced-motion`
 *  neutralises `ta-marquee` (globals.css), which parks the strip at translateX(0) and makes
 *  everything past the first couple of chips permanently unreachable for those users. So that case
 *  renders a static subset instead of a frozen marquee — the least-recovered muscles, which is the
 *  signal here, plus a count of the rest. Both branches are one line tall, so the card's geometry
 *  does not depend on which one is showing.
 *
 *  The swap is CSS-only (`.recovery-marquee` / `.recovery-static`) rather than a matchMedia effect,
 *  so there is no hydration mismatch and no first-paint flash of the wrong branch. */
export function MuscleRecoveryCard({ muscles }: MuscleRecoveryCardProps) {
  if (muscles.length === 0) return null;

  // Duplicated for a seamless loop; speed scales with count so a long list doesn't rush past.
  const pills = [...muscles, ...muscles];
  const duration = Math.max(8, muscles.length * 2.5);

  // `muscles` arrives sorted ascending by recovery, so the first two are the least-recovered.
  const STATIC_CHIPS = 2;
  const shown = muscles.slice(0, STATIC_CHIPS);
  const hidden = muscles.length - shown.length;

  return (
    <div
      className="flex items-center gap-2 min-w-0"
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 24px" } as React.CSSProperties}
    >
      <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground flex-none">
        Recovery
      </span>

      <div className="recovery-marquee flex-1 min-w-0 overflow-hidden">
        <div
          className="flex gap-1.5"
          style={{ width: "max-content", animation: `ta-marquee ${duration}s linear infinite` }}
        >
          {pills.map((m, i) => <Chip key={`${m.muscle}-${i}`} muscle={m.muscle} pct={m.pct} />)}
        </div>
      </div>

      <div className="recovery-static flex-1 min-w-0 items-center gap-1.5 overflow-hidden">
        {shown.map(m => <Chip key={m.muscle} muscle={m.muscle} pct={m.pct} />)}
        {hidden > 0 && (
          <span
            className="flex-none text-[10px] tabular-nums text-muted-foreground"
            title={muscles.slice(STATIC_CHIPS).map(m => `${capitalize(m.muscle)} ${m.pct}%`).join(", ")}
          >
            +{hidden}
          </span>
        )}
      </div>
    </div>
  );
}

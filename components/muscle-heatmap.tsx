"use client";

import { memo } from "react";
import dynamic from "next/dynamic";
import type { Slug, ExtendedBodyPart } from "react-muscle-highlighter";
import { normalizeMuscle } from "@trainingai/shared/muscles";

const Body = dynamic(() => import("react-muscle-highlighter").then((m) => ({ default: m.default })), {
  ssr: false,
  loading: () => <div className="w-full" style={{ aspectRatio: "1/2" }} />,
});

export interface MuscleActivation {
  muscle: string;
  role: "main" | "secondary" | "injured";
}

const MUSCLE_TO_SLUG: Record<string, Slug> = {
  chest: "chest",
  shoulders: "deltoids",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "forearm",
  abs: "abs",
  obliques: "obliques",
  "hip flexors": "abs",
  quads: "quadriceps",
  adductors: "adductors",
  calves: "calves",
  traps: "trapezius",
  "upper back": "upper-back",
  back: "upper-back",
  lats: "upper-back",
  "lower back": "lower-back",
  glutes: "gluteal",
  hamstrings: "hamstring",
};

const PRIMARY_COLOR = "#22c55e";
const SECONDARY_COLOR = "#f59e0b";
const INJURED_COLOR = "#ef4444";
// Every stop clears the 3:1 non-text floor against an untouched muscle — which is `defaultFill`
// below composited over `--card`, not `--card` itself. The old ramp opened on green-900/800, which
// measured 1.65:1 and 2.11:1 against that: a muscle trained to a fifth of its target could not be
// told from one never trained, so the map under-reported exactly what it exists to flag.
//
// Lifting only the bottom two stops — the obvious fix — does not work. The floor sits at luminance
// 0.159 and the third stop was already 0.269, so the two lifted stops and their separation from it
// would have to share a total contrast range of 1.52:1. The ramp is re-spaced instead, which also
// makes the steps more even than before (1.34 / 1.45 / 1.31 / 1.24 against 1.28 / 2.16 / 1.45 / 1.31).
//
// The opening stop is not a Tailwind green: `--card` carries the user's brand hue, and green-700
// falls to 2.99:1 at hue 144. `scripts/check-contrast.js` scores every stop at its worst hue.
const VOLUME_TINT_STEPS = ["#178a42", "#16a34a", "#22c55e", "#4ade80", "#86efac"];
const DEFAULT_VOLUME_TARGET = 10;

function buildBodyData(activations: Map<string, "main" | "secondary" | "injured">): ExtendedBodyPart[] {
  const result: ExtendedBodyPart[] = [];
  for (const [muscle, role] of activations) {
    const slug = MUSCLE_TO_SLUG[normalizeMuscle(muscle)];
    if (slug) {
      const color = role === "injured" ? INJURED_COLOR : role === "main" ? PRIMARY_COLOR : SECONDARY_COLOR;
      result.push({ slug, color });
    }
  }
  return result;
}

function buildVolumeBodyData(volumes: Array<{ muscle: string; sets: number; target?: number | null }>): ExtendedBodyPart[] {
  const result: ExtendedBodyPart[] = [];
  for (const { muscle, sets, target } of volumes) {
    if (sets <= 0) continue;
    const slug = MUSCLE_TO_SLUG[normalizeMuscle(muscle)];
    if (!slug) continue;
    const ratio = Math.max(0, Math.min(1, sets / (target ?? DEFAULT_VOLUME_TARGET)));
    const color = VOLUME_TINT_STEPS[Math.min(4, Math.floor(ratio * 5))];
    result.push({ slug, color });
  }
  return result;
}

interface MuscleHeatmapProps {
  muscleNames?: string[];
  assignments?: MuscleActivation[];
  volumes?: Array<{ muscle: string; sets: number; target?: number | null }>;
  className?: string;
  compact?: boolean;
  gender?: 'male' | 'female';
  /** Suppress the "select exercises" hint when the body is a live reflection of a control the
   *  user is already looking at (the check-in's sore-muscle pills) — there, an empty body IS
   *  the message, and the hint just replaces the figure with floating text. */
  showEmptyHint?: boolean;
}

export const MuscleHeatmap = memo(function MuscleHeatmap({ muscleNames, assignments, volumes, className, compact, gender = 'male', showEmptyHint = true }: MuscleHeatmapProps) {
  const activations = new Map<string, "main" | "secondary" | "injured">();

  if (assignments?.length) {
    for (const a of assignments) {
      const key = normalizeMuscle(a.muscle);
      // injured takes precedence over main/secondary
      if (a.role === "injured" || !activations.has(key)) {
        activations.set(key, a.role);
      }
    }
  } else if (muscleNames?.length) {
    for (const m of muscleNames) activations.set(normalizeMuscle(m), "main");
  }

  const usingVolumes = !assignments?.length && !muscleNames?.length && !!volumes?.length;
  const hasActivity = usingVolumes ? volumes!.some(v => v.sets > 0) : activations.size > 0;
  const bodyData = usingVolumes ? buildVolumeBodyData(volumes!) : buildBodyData(activations);

  return (
    <div className={className}>
      {hasActivity && !compact && [... activations.values()].includes("injured") && (
        <div className="flex items-center gap-4 mb-2 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: INJURED_COLOR }} />
            Injured
          </span>
        </div>
      )}
      {/* The volume ramp is a quantitative scale with no on-screen meaning, and its middle stop is
          `PRIMARY_COLOR` — the same fill the role scale uses for "primary mover". The key is what
          says which of the two is being read, so it is NOT gated on `!compact`: both volume callers
          pass `compact`, which is precisely where it is needed. */}
      {hasActivity && usingVolumes && (
        <div className="flex items-center justify-center gap-1.5 mb-2 text-[10px] text-muted-foreground flex-wrap">
          <span className="sr-only">Shading shows weekly sets as a share of target, from under 20% to at target.</span>
          <span aria-hidden="true">Under 20%</span>
          <span className="flex gap-px" aria-hidden="true">
            {VOLUME_TINT_STEPS.map((tint) => (
              <span key={tint} className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: tint }} />
            ))}
          </span>
          <span aria-hidden="true">At target</span>
        </div>
      )}
      <div className={compact ? "grid grid-cols-2 gap-1 overflow-hidden" : "grid grid-cols-2 gap-4 overflow-hidden"}>
        <div className="min-w-0 overflow-hidden [&_svg]:w-full [&_svg]:h-auto">
          {/* Sight-readable from the silhouette, so the visible label was noise (Q-97-followup) —
              at the 64px width `exercise-history-sheet` renders it at, it was unreadable anyway.
              Kept for screen readers, which get nothing from the shape. */}
          <p className="sr-only">Front</p>
          <Body
            data={bodyData}
            side="front"
            gender={gender}
            defaultFill="rgba(128,128,128,0.18)"
            defaultStroke="rgba(128,128,128,0.3)"
            defaultStrokeWidth={0.5}
            border="none"
          />
        </div>
        <div className="min-w-0 overflow-hidden [&_svg]:w-full [&_svg]:h-auto">
          <p className="sr-only">Back</p>
          <Body
            data={bodyData}
            side="back"
            gender={gender}
            defaultFill="rgba(128,128,128,0.18)"
            defaultStroke="rgba(128,128,128,0.3)"
            defaultStrokeWidth={0.5}
            border="none"
          />
        </div>
      </div>
      {!hasActivity && showEmptyHint && (
        <p className="text-center text-xs text-muted-foreground py-4">
          Select exercises to see targeted muscles
        </p>
      )}
    </div>
  );
});

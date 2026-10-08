"use client";

import { memo } from "react";
import dynamic from "next/dynamic";
import type { Slug, ExtendedBodyPart } from "react-muscle-highlighter";
import { normalizeMuscle } from "@trainingai/shared/muscles";
import { muscleVolumeColor } from "@/components/health/volume-band";

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
// Volume mode has no ramp of its own any more (#2554). The patch is the bar's colour — the
// green / amber / red / grey rule lives once in `components/health/volume-band.ts`
// (`muscleVolumeColor`) — so the map cannot read "far under" in green while the bars read it red.
// Those are theme tokens, so they reach the SVG as `var(--accent-green)` etc. and follow light/dark;
// `scripts/check-contrast.js` holds each against the untrained fill at 3:1 in both themes (RV-101).
// An injured muscle is marked by an outline, never by fill: the fill is the volume reading, and an
// injury's red would be indistinguishable from "under target".
const INJURY_OUTLINE = "var(--foreground)";
const INJURY_OUTLINE_WIDTH = 7;

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

export interface MuscleVolume {
  muscle: string;
  sets: number;
  target?: number | null;
  /** The patch colour. Absent → derived from `sets` and `target` by the shared rule; a caller that
   *  also draws the bars passes the colour it gave them, so both come from one computation. */
  color?: string;
}

function buildVolumeBodyData(volumes: MuscleVolume[], injured: string[] | undefined): ExtendedBodyPart[] {
  const result: ExtendedBodyPart[] = [];
  const injuredSlugs = new Set<Slug>();
  for (const m of injured ?? []) {
    const slug = MUSCLE_TO_SLUG[normalizeMuscle(m)];
    if (slug) injuredSlugs.add(slug);
  }
  const seen = new Set<Slug>();
  for (const { muscle, sets, target, color } of volumes) {
    if (sets <= 0) continue;
    const slug = MUSCLE_TO_SLUG[normalizeMuscle(muscle)];
    if (!slug) continue;
    seen.add(slug);
    result.push({
      slug,
      color: color ?? muscleVolumeColor(sets, target),
      ...(injuredSlugs.has(slug) && { styles: { stroke: INJURY_OUTLINE, strokeWidth: INJURY_OUTLINE_WIDTH } }),
    });
  }
  // An injured muscle with no sets is still outlined, on the untrained fill.
  for (const slug of injuredSlugs) {
    if (!seen.has(slug)) result.push({ slug, styles: { stroke: INJURY_OUTLINE, strokeWidth: INJURY_OUTLINE_WIDTH } });
  }
  return result;
}

/** What an untouched muscle is painted with. Kept as a literal `defaultFill` on the two bodies
 *  below because `scripts/check-contrast.js` reads it from there; this mirror feeds the key. */
const UNTRAINED_FILL = "rgba(128,128,128,0.18)";

function KeyItem({ fill, label, outlined, ring }: { fill: string; label: string; outlined?: boolean; ring?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block w-2.5 h-2.5 rounded-[2px]"
        style={{
          backgroundColor: fill,
          ...(outlined && { boxShadow: "0 0 0 1px var(--border)" }),
          ...(ring && { boxShadow: `inset 0 0 0 1.5px ${INJURY_OUTLINE}` }),
        }}
      />
      {label}
    </span>
  );
}

interface MuscleHeatmapProps {
  muscleNames?: string[];
  assignments?: MuscleActivation[];
  volumes?: MuscleVolume[];
  /** Volume mode only: muscles to outline as injured. */
  injuredMuscles?: string[];
  /** Volume mode only. "target" — every patch is graded against a program target, so the key names
   *  the three bands. "bars" — the bars use goal landmarks or the generic band, which have bands of
   *  their own, so the key points at the bars instead of naming thresholds that would be wrong. */
  volumeKey?: "target" | "bars";
  className?: string;
  compact?: boolean;
  gender?: 'male' | 'female';
  /** Suppress the "select exercises" hint when the body is a live reflection of a control the
   *  user is already looking at (the check-in's sore-muscle pills) — there, an empty body IS
   *  the message, and the hint just replaces the figure with floating text. */
  showEmptyHint?: boolean;
}

export const MuscleHeatmap = memo(function MuscleHeatmap({ muscleNames, assignments, volumes, injuredMuscles, volumeKey = "target", className, compact, gender = 'male', showEmptyHint = true }: MuscleHeatmapProps) {
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
  const bodyData = usingVolumes ? buildVolumeBodyData(volumes!, injuredMuscles) : buildBodyData(activations);

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
      {/* The key says which scale is being read: the role scale's "primary mover" is the same green
          as "at target" here. It is NOT gated on `!compact` — both volume callers pass `compact`,
          which is precisely where it is needed. */}
      {hasActivity && usingVolumes && (
        <div className="flex items-center justify-center gap-x-2.5 gap-y-1 mb-2 text-[10px] text-muted-foreground flex-wrap">
          <span className="sr-only">
            {volumeKey === "target"
              ? "Colour shows weekly sets as a share of target: red under 60%, amber 60 to 99%, green at or above target, grey not trained."
              : "Colours match the bars below. Grey is not trained."}
          </span>
          <span className="flex items-center gap-2.5 flex-wrap justify-center" aria-hidden="true">
            {volumeKey === "target" ? (
              <>
                <KeyItem fill="var(--destructive)" label="Under 60%" />
                <KeyItem fill="var(--accent-amber)" label="60–99%" />
                <KeyItem fill="var(--accent-green)" label="At target" />
              </>
            ) : (
              <span>Colours match the bars below</span>
            )}
            <KeyItem fill={UNTRAINED_FILL} label="Not trained" outlined />
            {!!injuredMuscles?.length && <KeyItem fill="transparent" label="Injured" ring />}
          </span>
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

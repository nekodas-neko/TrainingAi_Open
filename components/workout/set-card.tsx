"use client";

import { memo } from "react";
import { CheckCircle2 } from "lucide-react";
import { formatTime, formatSetLoadParts, weightStepFor, clampVoiceLogResult, mroundStep } from "./utils";
import { WeightDial } from "@/components/ui/weight-dial";
import { AddedWeightToggle } from "./added-weight-toggle";
import { RpeSlider, RPE_COLORS } from "./rpe-strip";
import type { ExerciseType } from "@trainingai/shared/types/program";
import { VoiceLogButton } from "./voice-log-button";

interface SetCardProps {
  index: number;
  currentSet: number;
  workoutPhase: "rest" | "set";
  repValue: number;
  weight: number;
  lapTime: number | undefined;
  restTime: number | undefined;
  intensityPct?: number;
  onRepChange: (index: number, value: number) => void;
  onWeightChange?: (index: number, value: number) => void;
  isAmrap?: boolean;
  exerciseType?: ExerciseType;
  equipment?: string[];
  rpeValue?: number;
  onRpeChange?: (value: number) => void;
  loggedRpe?: number;
}

function SetCardComponent({
  index,
  currentSet,
  workoutPhase,
  repValue,
  weight,
  lapTime,
  restTime,
  intensityPct,
  onRepChange,
  onWeightChange,
  isAmrap,
  exerciseType,
  equipment,
  rpeValue,
  onRpeChange,
  loggedRpe,
}: SetCardProps) {
  const isDone = index < currentSet;
  const isActive = index === currentSet;
  const isBodyweight = exerciseType === "bodyweight";

  if (isDone) {
    const { weightLabel, repsLabel } = formatSetLoadParts(weight, repValue, exerciseType);
    return (
      <div className="flex items-center gap-3 rounded-2xl p-2.5 border"
        style={{ background: "color-mix(in oklch, var(--accent-green) 4%, transparent)", borderColor: "color-mix(in oklch, var(--accent-green) 18%, transparent)" }}>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-none"
          style={{ background: "color-mix(in oklch, var(--accent-green) 10%, transparent)", border: "1px solid color-mix(in oklch, var(--accent-green) 20%, transparent)" }}>
          <CheckCircle2 className="h-4 w-4" style={{ color: "var(--accent-green)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-muted-foreground">{isAmrap ? 'AMRAP' : `Set ${index + 1}`} · Logged</p>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            {weightLabel ? (
              <>
                <p className="text-sm font-bold tabular-nums">{weightLabel}</p>
                <p className="text-xs text-muted-foreground">{repsLabel}</p>
              </>
            ) : (
              <p className="text-sm font-bold tabular-nums">{repsLabel}</p>
            )}
          </div>
        </div>
        <div className="text-right flex-none">
          {lapTime !== undefined && <p className="text-[11px] text-muted-foreground">{formatTime(lapTime)} set</p>}
          {restTime !== undefined && <p className="text-[11px] text-muted-foreground">{restTime}s rest</p>}
          {loggedRpe !== undefined && (
            <p
              className="text-[11px] font-bold leading-none mt-0.5"
              style={{ color: RPE_COLORS[loggedRpe] }}
            >
              RPE {loggedRpe}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (isActive) {
    const handleWeightChange = (v: number) => onWeightChange?.(index, v)
    const handleVoiceResult = (weight?: number, reps?: number) => {
      const clamped = clampVoiceLogResult(weight, reps)
      if (clamped.reps !== undefined) onRepChange(index, clamped.reps)
      if (clamped.weight !== undefined) onWeightChange?.(index, mroundStep(clamped.weight, weightStepFor(equipment)))
    }

    return (
      <div className="relative">
        {/* SVG animated border — set phase only. Sits outside the card so no overflow-hidden needed */}
        {workoutPhase === "set" && (
          <svg
            className="absolute pointer-events-none z-10"
            style={{ inset: "-2px", width: "calc(100% + 4px)", height: "calc(100% + 4px)", overflow: "visible" }}
          >
            <rect
              className="border-run"
              x="1" y="1"
              width="calc(100% - 2px)" height="calc(100% - 2px)"
              rx="18" ry="18"
              fill="none"
              stroke="var(--color-brand)"
              strokeWidth="2"
              pathLength="1000"
              strokeDasharray="970 30"
              style={{ animation: "border-run 3s linear infinite" }}
            />
          </svg>
        )}

        {/* Card */}
        <div
          className="relative rounded-[18px] border overflow-hidden"
          style={{
            background: "color-mix(in oklab, var(--color-brand) 7%, var(--color-background))",
            borderColor: "color-mix(in oklch, var(--color-brand) 25%, transparent)",
          }}
        >
          {isBodyweight ? (
            <>
              {/* Reps — centred, full width */}
              <div className="flex items-center justify-center gap-5 pt-10 pb-4 px-4">
                <button
                  onClick={() => onRepChange(index, Math.max(1, repValue - 1))}
                  aria-label={`Decrease reps to ${Math.max(1, repValue - 1)}`}
                  className="w-14 h-14 rounded-xl text-2xl font-bold flex items-center justify-center transition-transform active:scale-90"
                  style={{
                    background: "color-mix(in oklab, var(--color-brand) 18%, var(--color-muted))",
                    color: "var(--color-brand)",
                  }}
                >−</button>
                <div className="flex flex-col items-center">
                  <span className="text-6xl font-black tabular-nums leading-none" style={{ color: "var(--color-brand)" }}>
                    {repValue}
                  </span>
                  <span className="text-[11px] text-muted-foreground mt-1.5">reps</span>
                  {isAmrap && (
                    <span className="text-[11px] font-bold uppercase tracking-wide leading-none mt-1" style={{ color: "var(--color-brand)" }}>
                      AMRAP · beat it
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onRepChange(index, repValue + 1)}
                  aria-label={`Increase reps to ${repValue + 1}`}
                  className="w-14 h-14 rounded-xl text-2xl font-bold flex items-center justify-center transition-transform active:scale-90"
                  style={{
                    background: "color-mix(in oklab, var(--color-brand) 18%, var(--color-muted))",
                    color: "var(--color-brand)",
                  }}
                >+</button>
              </div>

              {/* Added/assisted weight — collapsible */}
              <div className="px-3 pb-2">
                <AddedWeightToggle value={weight} onChange={handleWeightChange} />
              </div>

              {/* Voice logging */}
              <div className="flex justify-center pb-1">
                <VoiceLogButton onResult={handleVoiceResult} />
              </div>

              {/* RPE slider */}
              <RpeSlider value={rpeValue ?? 7} onChange={onRpeChange ?? (() => {})} />
            </>
          ) : (
            <>
              {/* Weight + Reps row */}
              <div className="flex items-center pt-9 pb-4">
                {/* Weight dial */}
                <div className="flex items-center justify-center px-3 flex-1">
                  {onWeightChange ? (
                    <WeightDial
                      value={weight}
                      onChange={handleWeightChange}
                      min={0}
                      max={250}
                      step={weightStepFor(equipment)}
                      unit="kg"
                      visible={3}
                      pill
                    />
                  ) : (
                    <p className="text-3xl font-black tabular-nums">
                      {weight} <span className="text-sm font-normal text-muted-foreground">kg</span>
                    </p>
                  )}
                </div>

                {/* × separator */}
                <span className="text-2xl text-muted-foreground/30 font-light">×</span>

                {/* Reps counter */}
                <div className="flex items-center justify-center px-3 flex-1">
                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      onClick={() => onRepChange(index, repValue + 1)}
                      aria-label={`Increase reps to ${repValue + 1}`}
                      className="w-14 h-14 rounded-xl text-2xl font-bold flex items-center justify-center transition-transform active:scale-90"
                      style={{
                        background: "color-mix(in oklab, var(--color-brand) 18%, var(--color-muted))",
                        color: "var(--color-brand)",
                      }}
                    >+</button>
                    <div className="flex flex-col items-center">
                      <span
                        className="text-5xl font-black tabular-nums leading-none"
                        style={{ color: "var(--color-brand)" }}
                      >{repValue}</span>
                      {intensityPct != null && (
                        <span className="text-[11px] text-muted-foreground leading-none mt-0.5 tabular-nums">
                          {intensityPct}%
                        </span>
                      )}
                      {isAmrap && (
                        <span className="text-[11px] font-bold uppercase tracking-wide leading-none mt-1" style={{ color: "var(--color-brand)" }}>
                          AMRAP · beat it
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => onRepChange(index, Math.max(1, repValue - 1))}
                      aria-label={`Decrease reps to ${Math.max(1, repValue - 1)}`}
                      className="w-14 h-14 rounded-xl text-2xl font-bold flex items-center justify-center transition-transform active:scale-90"
                      style={{
                        background: "color-mix(in oklab, var(--color-brand) 18%, var(--color-muted))",
                        color: "var(--color-brand)",
                      }}
                    >−</button>
                  </div>
                </div>
              </div>

              {/* Voice logging */}
              <div className="flex justify-center pb-1">
                <VoiceLogButton onResult={handleVoiceResult} />
              </div>

              {/* RPE slider at the bottom of the card */}
              <RpeSlider value={rpeValue ?? 7} onChange={onRpeChange ?? (() => {})} />
            </>
          )}

          {/* Set badge — top-left overlay */}
          <div
            className="absolute top-2 left-2 w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black z-10"
            style={{
              background: "var(--color-brand)",
              color: "var(--brand-foreground)",
              boxShadow: workoutPhase === "set" ? "0 0 10px var(--color-brand)" : "none",
            }}
          >
            {isAmrap ? 'A' : index + 1}
          </div>
        </div>

        {workoutPhase === "set" && (
          <div
            className="absolute inset-0 rounded-[18px] blur-xl opacity-15 pointer-events-none -z-10"
            style={{ background: "var(--color-brand)" }}
          />
        )}
      </div>
    );
  }

  // Upcoming set
  const isNextUp = index === currentSet + 1 || (index === currentSet && workoutPhase === "rest");
  const { weightLabel, repsLabel } = formatSetLoadParts(weight, repValue, exerciseType);

  return (
    <div
      className="relative flex items-center gap-3 rounded-2xl p-2.5 border transition-all"
      style={{
        background: isNextUp
          ? "color-mix(in oklch, var(--color-brand) 5%, transparent)"
          : "transparent",
        borderColor: isNextUp
          ? "color-mix(in oklch, var(--color-brand) 20%, transparent)"
          : "var(--color-border)",
        opacity: index > currentSet + 2 ? 0.35 : 1,
        boxShadow: isNextUp
          ? "0 0 12px color-mix(in oklch, var(--color-brand) 12%, transparent)"
          : "none",
      }}
    >
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center flex-none text-xs font-bold"
        style={{
          background: isNextUp
            ? "color-mix(in oklab, var(--color-brand) 18%, var(--color-muted))"
            : "var(--color-muted)",
          color: isNextUp ? "var(--color-brand)" : "var(--color-muted-foreground)",
        }}
      >
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-muted-foreground">{isAmrap ? 'AMRAP' : `Set ${index + 1}`} · {isNextUp ? "Up next" : "Upcoming"}</p>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          {weightLabel ? (
            <>
              <p className="text-sm font-bold tabular-nums">{weightLabel}</p>
              <p className="text-xs text-muted-foreground">{repsLabel}</p>
            </>
          ) : (
            <p className="text-sm font-bold tabular-nums">{repsLabel}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export const SetCard = memo(SetCardComponent);

"use client"

import { useEffect, useState } from "react"
import { setColor, formatTime } from "./utils"
import { useWorkoutStore } from "@/lib/stores/workout-store"

const REST_COLOR = "#94a3b8"
const OVER_COLOR = "#f87171"
const D = 144
const CX = D / 2
const CY = D / 2
const R = 56
const CIRC = 2 * Math.PI * R

interface PipViewProps {
  exerciseName: string | undefined
  workoutPhase: "rest" | "set"
  currentSet: number
  sets: number
  currentRestSec: number
  lapStartMs: number | null
  restStartMs: number | null
}

export function PipView({
  exerciseName,
  workoutPhase,
  currentSet,
  sets,
  currentRestSec,
  lapStartMs,
  restStartMs,
}: PipViewProps) {
  // Read weight + reps directly from the store rather than via props computed by the orchestrator —
  // both mutate on the dial/rep hot path and are no longer in the orchestrator's own pick. This
  // component only mounts during native picture-in-picture (no dial interaction possible), so the
  // direct subscription is free of any hot-path re-render cost.
  const perSetWeights = useWorkoutStore(s => s.perSetWeights)
  const weight = perSetWeights[currentSet] ?? perSetWeights[0] ?? 60
  const reps = useWorkoutStore(s => s.reps[currentSet] ?? s.reps[0] ?? 10)
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const now = Date.now()
  const restElapsed = workoutPhase === "rest" && restStartMs !== null
    ? Math.floor((now - restStartMs) / 1000) : 0
  const setElapsed = workoutPhase === "set" && lapStartMs !== null
    ? Math.floor((now - lapStartMs) / 1000) : 0
  const overTime = workoutPhase === "rest" && currentRestSec > 0 && restElapsed >= currentRestSec
  const timerSec = workoutPhase === "rest" ? restElapsed : setElapsed

  // Rest arc: fills toward target then stays full (red when over)
  // Set arc: grows up to a 3-min visual cap, pulses
  const arcFraction = workoutPhase === "rest"
    ? (currentRestSec > 0 ? Math.min(restElapsed / currentRestSec, 1) : 0)
    : Math.min(setElapsed / 180, 1)
  const arcColor = workoutPhase === "rest"
    ? (overTime ? OVER_COLOR : REST_COLOR)
    : setColor(currentSet)
  const arcLen = arcFraction * CIRC

  const allSetsDone = workoutPhase === "rest" && currentSet >= sets

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-1 select-none">
      {exerciseName && (
        <p className="text-[9px] uppercase tracking-widest px-3 truncate max-w-full text-center"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          {exerciseName}
        </p>
      )}

      <div className="relative" style={{ width: D, height: D }}>
        <svg width={D} height={D} viewBox={`0 0 ${D} ${D}`}>
          <g transform={`rotate(-90, ${CX}, ${CY})`}>
            {/* Track */}
            <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
            {/* Arc */}
            {arcLen > 0 && (
              <circle cx={CX} cy={CY} r={R} fill="none"
                stroke={arcColor} strokeWidth="9" strokeLinecap="round"
                strokeDasharray={`${arcLen} ${CIRC - arcLen}`}
              >
                {workoutPhase === "set" && (
                  <animate attributeName="stroke-opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" />
                )}
              </circle>
            )}
          </g>
        </svg>

        {/* Centre */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono font-bold tabular-nums leading-none"
            style={{ fontSize: "2rem", color: overTime ? OVER_COLOR : "white" }}>
            {formatTime(timerSec)}
          </span>
          {workoutPhase === "rest" && currentRestSec > 0 && (
            <span className="text-[9px] uppercase tracking-wide mt-0.5"
              style={{ color: overTime ? OVER_COLOR : "rgba(255,255,255,0.4)" }}>
              {overTime
                ? `+${formatTime(restElapsed - currentRestSec)}`
                : `/ ${formatTime(currentRestSec)}`}
            </span>
          )}
          <span className="text-[9px] uppercase tracking-wide mt-0.5"
            style={{ color: "rgba(255,255,255,0.35)" }}>
            {workoutPhase === "rest"
              ? allSetsDone ? "done" : `rest · ${currentSet}/${sets}`
              : `set ${currentSet + 1}/${sets}`}
          </span>
        </div>
      </div>

      {/* Weight × reps shown during set */}
      {workoutPhase === "set" && (
        <p className="text-sm font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.8)" }}>
          {weight}kg × {reps}
        </p>
      )}
    </div>
  )
}

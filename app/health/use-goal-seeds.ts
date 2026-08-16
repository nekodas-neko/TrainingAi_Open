"use client";

import { useLayoutEffect, useState } from "react";
import { WATER_GOAL_KEY, TARGET_WEIGHT_KEY, TARGET_BF_KEY } from "@/lib/home/home-prefs";

export interface GoalSeeds {
  waterGoalSeed: number | null;
  targetWeightSeed: number | null;
  targetBfSeed: number | null;
}

function readNumber(key: string, parse: (s: string) => number): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const n = parse(raw);
    return isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

/**
 * The device-copy fallback for the three goals Health can render before `user-goals` loads.
 *
 * `useLayoutEffect` rather than a `useState` lazy initializer: an initializer would read
 * localStorage during SSR too and risk a hydration mismatch (PERF-7).
 *
 * **Re-reads on `tabEpoch`, and that is the point (Q-260).** The shell keeps all five tabs mounted
 * for the life of the app, so a mount-only read freezes these at whatever the device copy held when
 * the app launched — and the goals UI on More writes these keys synchronously on every keystroke.
 * Without the re-read, a goal edited on More could never reach Health while `userGoals` was unset.
 */
export function useGoalSeeds(tabEpoch: number): GoalSeeds {
  const [waterGoalSeed, setWaterGoalSeed] = useState<number | null>(null);
  const [targetWeightSeed, setTargetWeightSeed] = useState<number | null>(null);
  const [targetBfSeed, setTargetBfSeed] = useState<number | null>(null);

  useLayoutEffect(() => {
    setWaterGoalSeed(readNumber(WATER_GOAL_KEY, s => parseInt(s, 10)));
    setTargetWeightSeed(readNumber(TARGET_WEIGHT_KEY, parseFloat));
    setTargetBfSeed(readNumber(TARGET_BF_KEY, parseFloat));
  }, [tabEpoch]);

  return { waterGoalSeed, targetWeightSeed, targetBfSeed };
}

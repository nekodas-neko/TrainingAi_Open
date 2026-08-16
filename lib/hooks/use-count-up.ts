"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** Eased intermediate value. Exported for tests. */
export function easeOutCubicValue(t: number, target: number): number {
  const eased = 1 - Math.pow(1 - t, 3);
  return Math.round(target * eased * 100) / 100;
}

/** Eased interpolation from a starting value toward target. Exported for tests. */
export function interpolateCountUp(from: number, target: number, t: number): number {
  const eased = 1 - Math.pow(1 - t, 3);
  return Math.round((from + (target - from) * eased) * 100) / 100;
}

export function useCountUp(target: number | null, durationMs = 600): number | null {
  // Initial state = target (not 0) so a cache-seeded non-null target at mount
  // paints correctly on the first frame instead of flashing final → 0 → count-up.
  const [value, setValue] = useState<number | null>(target);
  const prevRef = useRef<number | null>(target);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (target === null || reduced || prevRef.current === target) {
      setValue(target);
      prevRef.current = target;
      return;
    }
    // Animate from the previously displayed value, not from 0 — a target change
    // (e.g. 75 -> 78) counts up from 75, not from scratch.
    const from = prevRef.current ?? target;
    prevRef.current = target;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setValue(interpolateCountUp(from, target, t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, reduced]);

  return value;
}

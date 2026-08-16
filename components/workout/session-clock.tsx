"use client";

import { useEffect, useState } from "react";
import { formatTime } from "./utils";

/** 1 Hz elapsed-seconds ticker. Lives in leaf components so the workout
 *  orchestrator no longer re-renders every second. */
export function useElapsedSec(startMs: number | null): number {
  const [elapsed, setElapsed] = useState(() =>
    startMs ? Math.floor((Date.now() - startMs) / 1000) : 0,
  );
  useEffect(() => {
    if (!startMs) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - startMs) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startMs]);
  return elapsed;
}

export function SessionClock({ startMs, className, style }: {
  startMs: number | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const elapsed = useElapsedSec(startMs);
  if (startMs == null) return null;
  return <span className={className} style={style}>{formatTime(elapsed)}</span>;
}

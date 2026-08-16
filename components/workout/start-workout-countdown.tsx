"use client";

import { useEffect, useState } from "react";

interface StartWorkoutCountdownProps {
  from: number;
  onComplete: () => void;
  onCancel: () => void;
}

// Self-ticking leaf — owns its own 1 Hz countdown state so the ~380-line
// PreWorkoutScreen it's mounted from doesn't re-render every second (PRF-16).
export function StartWorkoutCountdown({ from, onComplete, onCancel }: StartWorkoutCountdownProps) {
  const [count, setCount] = useState(from);

  useEffect(() => {
    if (count === 0) {
      onComplete();
      return;
    }
    const id = setTimeout(() => setCount(c => c - 1), 1000);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
    >
      <p className="text-muted-foreground text-sm font-semibold uppercase tracking-widest mb-4">
        Starting in
      </p>
      <p
        className="text-9xl font-black tabular-nums"
        style={{ color: "var(--color-brand)", lineHeight: 1 }}
      >
        {count}
      </p>
      <button
        onClick={onCancel}
        className="mt-10 text-sm text-muted-foreground underline underline-offset-2"
      >
        Cancel
      </button>
    </div>
  );
}

"use client";

import { memo } from "react";
import { BrainIcon } from "lucide-react";
import type { MoodLog } from "@trainingai/shared/types/mood";

/**
 * The "how are you feeling?" prompt that opens the readiness check-in.
 *
 * `moodLog === undefined` means "not loaded yet" and is distinct from `null` ("loaded, nothing
 * logged today") — the card shows its heading alone while undefined rather than flashing the full
 * prompt and then a filled-in state.
 */
export const ReadinessCheckinCard = memo(function ReadinessCheckinCard({
  moodLog,
  onOpen,
}: {
  moodLog: MoodLog | null | undefined;
  onOpen: () => void;
}) {
  return (
    <div className="px-4 pb-3 pt-2">
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-2xl p-4 flex flex-col gap-3 text-left transition active:scale-95"
        style={{
          backgroundColor: "color-mix(in oklch, var(--muted) 60%, transparent)",
          backgroundImage:
            "linear-gradient(135deg, color-mix(in oklch, var(--accent-amber) 14%, transparent), color-mix(in oklch, var(--accent-amber) 4%, transparent))",
          border: "1px solid color-mix(in oklch, var(--accent-amber) 35%, transparent)",
        }}
      >
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--accent-amber)" }}>
          {moodLog === undefined ? "Loading…" : "Exercise Readiness"}
        </p>
        {moodLog !== undefined && (
          <>
            <div className="flex items-center gap-4">
              <BrainIcon className="w-9 h-9 flex-none" style={{ color: "var(--accent-amber)" }} />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-xl leading-tight">How are you feeling?</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Log soreness &amp; energy — the app lightens loads on sore muscles and can flag a deload or rest day. It tunes today&apos;s session, not your whole plan.
                </p>
              </div>
            </div>
            <div
              className="w-full rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2"
              style={{ background: "var(--accent-amber)", color: "#0a0a0a" }}
            >
              Log Readiness · ~15 sec
            </div>
          </>
        )}
      </button>
    </div>
  );
});

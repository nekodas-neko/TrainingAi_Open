// The sleep window to DISPLAY in a header/summary (start–end times), derived from the hypnogram.
//
// START: the actual sleep-start — the bedtime with onset latency trimmed off, anchored to the
// hypnogram's first non-awake 5-min block (code '4' = awake), the same way the ribbon is rendered.
//
// END: the ring's ACTUAL recorded wake time (phaseWindowEnd ?? sleepEnd) — the same value the
// hypnogram ribbon's x-axis uses. It is deliberately NOT recomputed as base + codes.length epochs:
// the phase string is padded UP to a whole number of 5-min epochs at build time
// (nEpochs = ceil(window / 5min) in the BLE aggregate), so base + codes.length overshoots the real
// wake time by up to ~5 min. That overshoot is invisible most of the day but reads as a wake time
// IN THE FUTURE when the night is opened right after waking (a 6:03 am wake showing 6:07 am), and it
// silently disagrees with the ribbon's own axis directly below it. Using the recorded end fixes both.
//
// The end is NOT trimmed to the last non-awake block either: a trailing awake stretch (lying in bed
// after waking, before getting up) is still part of the session, and the stage-minute totals (Awake
// includes it) and the ribbon's x-axis both span the full recorded window — trimming the header's
// end but not those would make the displayed range silently disagree with the numbers below it (the
// 07-08 "lost 15 minutes" bug).
//
// Returns null when there's no hypnogram (or no recorded window) to read — callers fall back to the
// raw sleepStart/sleepEnd.
export function actualSleepWindow(r: {
  sleepPhase5Min?: string | null;
  phaseWindowStart?: string | null;
  phaseWindowEnd?: string | null;
  sleepStart?: string | null;
  sleepEnd?: string | null;
}): { start: string; end: string } | null {
  const base = r.phaseWindowStart ?? r.sleepStart;
  const recordedEnd = r.phaseWindowEnd ?? r.sleepEnd;
  if (!r.sleepPhase5Min || !base || !recordedEnd) return null;
  const codes = r.sleepPhase5Min;
  const first = [...codes].findIndex(c => c !== "4");
  if (first < 0) return null; // all awake — nothing to show
  const endMs = new Date(recordedEnd).getTime();
  // Onset (leading awake trimmed), but never past the ring's actual recorded wake time.
  const onsetMs = Math.min(new Date(base).getTime() + first * 5 * 60000, endMs);
  return {
    start: new Date(onsetMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}

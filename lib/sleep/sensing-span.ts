// Clamp a detected night window to the ring's actual continuous sleep-sensing span, identified by
// HR-sample (beat) DENSITY per 5-min epoch.
//
// The night window (from a bedtime event or a 0x72/0x75 cluster) can extend well past real sleep at
// either end: the ring spot-checks HR (a few beats per epoch) and can briefly wake its sensors during
// evening wind-down, but only streams DENSE continuous HR (hundreds of beats per 5-min epoch) while
// actually asleep. Two owner per-epoch dumps proved it:
//   • 2026-07-14: sparse spot-readings (≤129 beats) until 22:09, then dense (≥294) — real 10pm bedtime.
//   • 2026-07-15: a 3-epoch dense-but-AWAKE burst at 19:53–20:03 (HR ~73, moving), then ~2h of sparse
//     spot-readings, then dense continuous sleep from 22:03.
//
// Approach: mark each epoch "dense" when its beat count clears a fraction of the night's peak, group
// dense epochs into runs (bridging tiny gaps), drop runs too SHORT to be sleep, then span from the
// LONGEST substantial run out to any other substantial run that's either COMPARABLE in length or
// CLOSE IN TIME. This:
//   • drops an isolated short evening burst (07-15's 3-epoch 19:53 blip — below minRun);
//   • drops an EVENING-ACTIVITY burst that is substantial but tiny vs the night AND far from it in
//     time (07-21: a 6-epoch dense burst at 17:19–17:44, ~4h before real sleep, made the window span
//     17:19→06:44 and read ~13h "asleep" — 6 epochs vs the ~100-epoch sleep run and a ~4h gap, so
//     it's excluded);
//   • still spans a night legitimately split into two real, comparable sleep clusters by a mid-night
//     wake (the 07-09 split-night case — both halves are long, ratio ~1);
//   • still spans a night interrupted asymmetrically — a real sleep bout cut short by a brief
//     interruption (phone call, bathroom trip), then a much longer bout after (08-03/08-04: a
//     130-min bout, a 15-min gap, then a 6h40m bout — comparable-length fails at ~0.33, but the
//     15-min gap is far under the 2h night-split threshold, so it's bridged in rather than dropped).
// When nothing substantial is dense (no real sleep signal), the window is returned unchanged so a
// real night is never trimmed to nothing.

export const DEFAULT_EPOCH_DS = 5 * 60 * 10; // one 5-min epoch in deciseconds
// Dense = beats ≥ FRACTION × the night's peak epoch. Calibrated against the dumps: sparse
// spot-readings top out ~160 beats while real sleep runs ≥250; 0.3×peak (≈190–210) sits cleanly
// between them, with margin.
const DEFAULT_FRACTION = 0.3;
// Non-dense epochs up to this many in a row are bridged WITHIN a run (a single no-signal blip
// mid-sleep, e.g. 07-15's 06:08). Kept tiny so a real mid-night gap still splits into two runs.
const DEFAULT_SMALL_GAP_EPOCHS = 2;
// A dense run shorter than this (≈30 min) is an incidental burst, not sleep, and dropped outright.
const DEFAULT_MIN_RUN_EPOCHS = 6;
// Span out to a neighbouring substantial run only if it's at least this fraction of the LONGEST run's
// length. A genuinely split night has two comparable halves (ratio ~1, kept); an evening-activity
// burst is tiny relative to the main sleep (07-21: 6 vs ~100, dropped).
const DEFAULT_MIN_NEIGHBOR_RATIO = 0.5;
// A substantial run separated from an already-kept run by a gap this short (≈1h) is bridged in
// REGARDLESS of the ratio test above. A real overnight interruption (phone call, bathroom trip) sits
// well under the 2h GAP_DS that splits nights into separate rows at the clustering stage in
// adapter.ts, so a run this close in time cannot be the "evening-activity burst hours before sleep"
// the ratio test exists to reject — it can only be an interruption within the same sleep period. An
// asymmetric interruption (a short pre-interruption bout, then a much longer post-interruption one)
// must not be dropped just because it fails the comparable-length check (08-03/08-04: a 130-min real
// sleep bout, 15-min phone-call gap, then a 6h40m bout — 130/400 ≈ 0.33 fails minNeighborRatio, but
// the 15-min gap is unambiguous proof it's one interrupted night, not a distant evening burst).
export const DEFAULT_MAX_BRIDGE_GAP_EPOCHS = 12;

export function clampToDenseSensing(
  window: { startDs: number; endDs: number },
  perEpochBeats: number[],
  epochDs = DEFAULT_EPOCH_DS,
  opts: {
    fraction?: number; smallGapEpochs?: number; minRunEpochs?: number
    minNeighborRatio?: number; maxBridgeGapEpochs?: number
  } = {},
): { startDs: number; endDs: number } {
  const span = denseSensingSpan(
    perEpochBeats,
    opts.fraction ?? DEFAULT_FRACTION,
    opts.smallGapEpochs ?? DEFAULT_SMALL_GAP_EPOCHS,
    opts.minRunEpochs ?? DEFAULT_MIN_RUN_EPOCHS,
    opts.minNeighborRatio ?? DEFAULT_MIN_NEIGHBOR_RATIO,
    opts.maxBridgeGapEpochs ?? DEFAULT_MAX_BRIDGE_GAP_EPOCHS,
  );
  if (!span) return window;
  return {
    // Never expand — only tighten. Extend the end by one epoch so the final partial epoch is covered.
    startDs: Math.max(window.startDs, window.startDs + span.start * epochDs),
    endDs: Math.min(window.endDs, window.startDs + (span.end + 1) * epochDs),
  };
}

// The inclusive epoch-index span [start, end] from the first to the last substantial dense run of
// COMPARABLE length — beats ≥ fraction × peak, grouped into runs that bridge ≤ smallGapEpochs
// non-dense epochs, keeping only runs ≥ minRunEpochs, then only those ≥ minNeighborRatio × the longest
// run. null when no substantial run exists (no real sleep signal). Exported for testing.
export function denseSensingSpan(
  perEpochBeats: number[],
  fraction = DEFAULT_FRACTION,
  smallGapEpochs = DEFAULT_SMALL_GAP_EPOCHS,
  minRunEpochs = DEFAULT_MIN_RUN_EPOCHS,
  minNeighborRatio = DEFAULT_MIN_NEIGHBOR_RATIO,
  maxBridgeGapEpochs = DEFAULT_MAX_BRIDGE_GAP_EPOCHS,
): { start: number; end: number } | null {
  const n = perEpochBeats.length;
  if (n === 0) return null;
  const peak = perEpochBeats.reduce((a, b) => Math.max(a, b), 0);
  if (peak <= 0) return null;
  const threshold = fraction * peak;
  const dense = perEpochBeats.map(b => b >= threshold);

  const runs: { start: number; end: number }[] = [];
  let i = 0;
  while (i < n) {
    if (!dense[i]) { i++; continue; }
    let end = i;
    let j = i + 1;
    while (j < n) {
      if (dense[j]) { end = j; j++; continue; }
      let g = j;
      while (g < n && !dense[g]) g++;
      if (g < n && g - j <= smallGapEpochs) { j = g; continue; } // bridge a tiny gap, stay in the run
      break;
    }
    runs.push({ start: i, end });
    i = end + 1;
  }

  const lenOf = (r: { start: number; end: number }) => r.end - r.start + 1;
  const substantial = runs.filter(r => lenOf(r) >= minRunEpochs);
  if (substantial.length === 0) return null;

  // Keep the longest run, then chain in any other substantial run that's either comparable in length
  // (a genuinely split night, roughly 50/50) OR close in time to an already-kept run (a real
  // interruption — see DEFAULT_MAX_BRIDGE_GAP_EPOCHS). Chaining lets a bridge-in run pull in a further
  // run in turn, so more than two fragments in one interrupted night still merge into one span.
  const longestLen = substantial.reduce((m, r) => Math.max(m, lenOf(r)), 0);
  const gapBetween = (a: { start: number; end: number }, b: { start: number; end: number }) =>
    a.start < b.start ? b.start - a.end - 1 : a.start - b.end - 1;
  const kept = new Set<number>();
  let longestIdx = 0;
  for (let i = 1; i < substantial.length; i++) if (lenOf(substantial[i]) > lenOf(substantial[longestIdx])) longestIdx = i;
  kept.add(longestIdx);
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < substantial.length; i++) {
      if (kept.has(i)) continue;
      for (const k of kept) {
        if (gapBetween(substantial[k], substantial[i]) <= maxBridgeGapEpochs || lenOf(substantial[i]) >= minNeighborRatio * longestLen) {
          kept.add(i);
          changed = true;
          break;
        }
      }
    }
  }
  const keptRuns = [...kept].map(i => substantial[i]).sort((a, b) => a.start - b.start);
  return { start: keptRuns[0].start, end: keptRuns[keptRuns.length - 1].end };
}

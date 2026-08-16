// lib/health/rmssd.ts
// rMSSD from raw RR intervals (ms). The ONLY RR→rMSSD implementation in the app
// (the ring's 0x5d events carry ring-precomputed rMSSD — different provenance).
// Artifact gate: successive pairs differing >20% are ectopic/dropped-beat noise
// and are excluded pairwise (standard Kubios-style threshold filter).
const MIN_BEATS = 30
const ARTIFACT_RATIO = 0.2

export function rmssdFromRr(rrMs: number[]): number | null {
  if (rrMs.length < MIN_BEATS) return null
  const sqDiffs: number[] = []
  for (let i = 1; i < rrMs.length; i++) {
    const a = rrMs[i - 1]
    const b = rrMs[i]
    if (Math.abs(b - a) > ARTIFACT_RATIO * a) continue
    sqDiffs.push((b - a) ** 2)
  }
  if (sqDiffs.length < MIN_BEATS / 2) return null
  const mean = sqDiffs.reduce((s, v) => s + v, 0) / sqDiffs.length
  return Math.sqrt(mean)
}

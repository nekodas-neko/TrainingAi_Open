// Frequency-domain HRV — the LF/HF autonomic-balance ratio as an independent REM/deep discriminator.
//
// HRV power partitions into bands: HF (0.15–0.40 Hz) tracks parasympathetic (vagal, respiratory)
// tone; LF (0.04–0.15 Hz) is a mixed sympathetic/baroreflex band. Their ratio LF/HF is the classic
// autonomic-balance index — REM leans sympathetic (LF/HF up), deep NREM parasympathetic (LF/HF down).
// This is a *different decomposition* of the tachogram than the time-domain terms already in the
// stager (RMSSD, HR spread), so it can move REM where re-weighting correlated terms cannot.
//
// Empirical discriminative feature, not a physiological claim — the "LF = sympathetic" reading is
// contested; we rely only on the REM>NREM separation of LF/HF that holds in wearable studies. The
// signal is density-gated: the LF band (periods 6.7–25 s) needs a long, beat-dense clean window, so
// on sparse epochs this returns null and stays neutral in the stager (exactly like breathVar).

import { resampleTachogram } from './tachogram'

const FS = 2 // Hz — Nyquist 1 Hz, comfortably above HF's 0.40 Hz upper edge
const MIN_BEATS = 90 // stricter than breathing's 40 — LF needs a longer clean window to resolve
const MIN_SPAN_MS = 4 * 60 * 1000 // ≥ 4 min of beats
const LF_LO = 0.04, LF_HI = 0.15
const HF_LO = 0.15, HF_HI = 0.40
const LFHF_MAX = 20 // clip before the z-score so one pathological epoch can't dominate

export interface LfHfResult {
  /** LF/HF power ratio (higher ⇒ REM-leaning), clipped to [0, LFHF_MAX]. null when density-gated. */
  lfhf: number | null
  /** Absolute LF-band power (ms², debug/tuning). */
  lf: number | null
  /** Absolute HF-band power (ms², debug/tuning). */
  hf: number | null
}

const NULL_RESULT: LfHfResult = { lfhf: null, lf: null, hf: null }

/**
 * LF/HF ratio from an ordered IBI sequence (ms) within one epoch. Resamples the tachogram to an even
 * 2 Hz grid, mean-detrends + Hann-windows it, takes a radix-2 FFT periodogram, and integrates power
 * over the LF and HF bands. Returns nulls on sparse/short input (neutral). Pure, deterministic; never
 * throws.
 */
export function lfhfFromIbi(ibiMs: number[]): LfHfResult {
  const tacho = resampleTachogram(ibiMs, FS)
  if (!tacho || tacho.beatCount < MIN_BEATS || tacho.spanMs < MIN_SPAN_MS) return NULL_RESULT

  const { grid } = tacho
  const n = grid.length
  if (n < 8) return NULL_RESULT

  // Mean-detrend (remove DC) + Hann window (reduce spectral leakage).
  const mean = grid.reduce((a, b) => a + b, 0) / n
  let nfft = 1
  while (nfft < n) nfft <<= 1
  const re = new Float64Array(nfft)
  const im = new Float64Array(nfft)
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
    re[i] = (grid[i] - mean) * w
  }

  fftRadix2(re, im)

  // One-sided periodogram; integrate |X|² over each band. Absolute PSD normalisation cancels in the
  // ratio, so summing raw |X|² over the bins is sufficient.
  const df = FS / nfft
  let lf = 0, hf = 0
  for (let k = 1; k < nfft / 2; k++) {
    const f = k * df
    const p = re[k] * re[k] + im[k] * im[k]
    if (f >= LF_LO && f < LF_HI) lf += p
    else if (f >= HF_LO && f <= HF_HI) hf += p
  }

  if (hf <= 0) return NULL_RESULT // no resolvable HF power → can't form a trustworthy ratio
  const lfhf = Math.min(LFHF_MAX, lf / hf)
  return {
    lfhf: Math.round(lfhf * 1000) / 1000,
    lf: Math.round(lf * 1000) / 1000,
    hf: Math.round(hf * 1000) / 1000,
  }
}

// In-place iterative radix-2 Cooley–Tukey FFT (length must be a power of two). Self-contained — no
// new dependency, cheap at one ~512-point transform per epoch.
function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang), wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2
        const vRe = re[b] * curRe - im[b] * curIm
        const vIm = re[b] * curIm + im[b] * curRe
        re[b] = re[a] - vRe; im[b] = im[a] - vIm
        re[a] = re[a] + vRe; im[a] = im[a] + vIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

# Chest-Strap Cadence Spike (De-Risk) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-risk deriving running **cadence** (steps/min) — and, secondarily, a step count — from the Polar H10 chest strap's raw accelerometer, behind the admin panel only, then produce a GO/NO-GO on promoting it to a real feature.

**Architecture:** The H10 exposes **no** step/cadence metric over BLE — only raw 3-axis accelerometer over the proprietary PMD service (`polar-h10-ble` skill §0/§3). So cadence must be **our own DSP**. This plan splits the work into two halves. The **sandbox-testable half** is three pure, unit-tested modules: PMD control-point command builders, the PMD ACC frame decoder (raw + delta), and the cadence DSP (`detectCadence`). The **device-only half** is the BLE streaming that drives the PMD service, an admin capture/tuning console mirroring the Oura BLE debug screen, and on-device tuning against a treadmill's displayed cadence. The standard Heart Rate Service keeps running exactly as today (`lib/live-hr/chest-strap-source.ts`); the PMD accelerometer stream is **additional** and, in the spike, is started manually from the admin console. Nothing here touches the live-HR manager's auto-start or the Oura pipeline.

**Tech Stack:** TypeScript, `@capacitor-community/bluetooth-le` (native plugin — owner APK rebuild required), Vitest for the pure modules, Next.js App Router admin page + React client component, Tailwind theme tokens, Lucide icons.

---

## Scope & framing (read before starting)

- **This is a spike, not a shipped feature.** Everything lands behind `/admin/chest-strap` (admin-gated, mirroring `app/admin/oura-ble/page.tsx`). No user-facing surface, no auto-wiring into workouts.
- **Cadence (steps/min, a live rate ~150–190 during running) is the valuable target** — the app has zero cadence today. **Step count is a secondary by-product.** Ambient daily steps stay on the Oura ring pipeline (`lib/oura-ble/gait-step-count.ts`) regardless of this spike's outcome.
- **Gate streaming to running / distance-based activity, bounded to an active run.** The PMD accelerometer stream (200 Hz) must never run during weights or ambient wear — it is battery- and bandwidth-costly. In the **spike**, the stream is started/stopped manually in the admin console. The **design for promotion** is: only distance-based activity types (`activity_types.is_distance_based = true`, `lib/data/postgres/schema.ts:272`) start the PMD stream; weights and ambient wear never do. The standard HR service (`lib/live-hr/chest-strap-source.ts`) is unaffected and keeps running as today.
- **NO DB MIGRATION for the spike.** Raw captures are exported/retried client-side exactly like the Oura `LiveStepTest` console (`components/oura-ble/live-step-test.tsx`: copy-JSON + a `localStorage` retry buffer) — no new table. If a persistent raw-accelerometer debug table is ever judged necessary, **claim a migration number at implementation time** (against the directory AND open PRs/plans, per CLAUDE.md) — it is out of scope here.
- **A real `cadence` / `cadence_series` column on `activity_logs` is explicitly OUT OF SCOPE.** That is the *promotion* step after a GO, and its migration is claimed then, not now (see the final GO/NO-GO task).
- **Decoders are infallible and pinned to captured vectors.** Every decoder returns `null` on malformed input and never throws (mirrors `lib/oura-ble/accel.ts` and the Oura pipeline rule). The synthetic vectors in the unit tests are placeholders for *real captured* vectors — the on-device task replaces/augments them, and no decoder is trusted until validated against a real capture (`polar-h10-ble` skill §8 risk 1 + risk 3).

---

## File structure

**Pure modules (sandbox-unit-testable — ship as JS, no rebuild):**

- Create `lib/live-hr/pmd-control.ts` — PMD Control-Point command byte builders (start ACC, stop, get-settings) + PMD service/characteristic UUIDs. One place for the control-point protocol.
- Create `lib/live-hr/pmd-accel.ts` — pure PMD ACC **data-frame decoder**: parses the common header, branches on the frame-type byte (raw vs delta-compressed), returns milli-g samples. Infallible.
- Create `lib/live-hr/cadence-detect.ts` — pure cadence DSP: `detectCadence(magnitudes, sampleRate)` (band-limited autocorrelation → steps/min + rhythm strength) and a secondary `countRunSteps`. One-Formula-One-Place for cadence.
- Create `lib/live-hr/__tests__/pmd-control.test.ts`
- Create `lib/live-hr/__tests__/pmd-accel.test.ts`
- Create `lib/live-hr/__tests__/cadence-detect.test.ts`

**Device-only modules (require the owner APK rebuild — BLE inert in the sandbox):**

- Create `lib/live-hr/pmd-accel-stream.ts` — thin BLE wrapper: enables Control-Point indications + Data notifications, writes the start command, decodes frames via `pmd-accel.ts`, forwards samples; stops cleanly. Mirrors the guarded-dynamic-import pattern in `chest-strap-source.ts`.
- Create `components/chest-strap/cadence-spike-console.tsx` — admin capture/tuning console: start/stop stream, live cadence readout, raw-magnitude capture + copy-JSON export, ground-truth cadence input, `localStorage` retry buffer. Mirrors `components/oura-ble/live-step-test.tsx`.
- Create `app/admin/chest-strap/page.tsx` — admin-gated page hosting the console. Mirrors `app/admin/oura-ble/page.tsx`.

**Reference files (read, do not modify):**

- `lib/live-hr/chest-strap-source.ts` — the H10 HR source + `HR_SERVICE`/`getBle()` pattern to copy.
- `lib/oura-ble/accel.ts` — infallible frame decoder + `StepPeakCounter` reference.
- `lib/oura-ble/gait-step-count.ts` — band-limited autocorrelation reference (`gaitBandAutocorr`).
- `components/oura-ble/live-step-test.tsx` — capture/export/retry console reference.
- `app/admin/oura-ble/page.tsx`, `lib/admin.ts` — admin page gating.
- `.claude/skills/polar-h10-ble/SKILL.md` §3 — the authoritative PMD protocol.

---

## Phase 1 — PMD Control-Point command builders (SANDBOX-TESTABLE)

The Control Point (`FB005C81-…`) is written to start/stop a PMD stream; sample frames then arrive on Data (`FB005C82-…`). Command bytes come from `polar-h10-ble` skill §3, cross-corroborated but **not extracted from the PMD spec PDF** — the on-device task confirms them.

### Task 1: PMD UUIDs + start/stop/get-settings command builders

**Files:**
- Create: `lib/live-hr/pmd-control.ts`
- Test: `lib/live-hr/__tests__/pmd-control.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/live-hr/__tests__/pmd-control.test.ts
import { describe, it, expect } from 'vitest'
import {
  PMD_SERVICE, PMD_CONTROL_POINT, PMD_DATA,
  buildAccStartCommand, buildAccStopCommand, buildGetSettingsCommand,
  PMD_MEAS_ACC,
} from '@/lib/live-hr/pmd-control'

const hex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(' ')

describe('pmd-control', () => {
  it('exposes the PMD service + characteristic UUIDs (skill §3)', () => {
    expect(PMD_SERVICE).toBe('fb005c80-02e7-f387-1cad-8acd2d8df0c8')
    expect(PMD_CONTROL_POINT).toBe('fb005c81-02e7-f387-1cad-8acd2d8df0c8')
    expect(PMD_DATA).toBe('fb005c82-02e7-f387-1cad-8acd2d8df0c8')
  })

  it('builds the 200 Hz / 16-bit / ±8 G ACC start command (skill §3)', () => {
    // 02 02  00 01 C8 00  01 01 10 00  02 01 08 00
    expect(hex(buildAccStartCommand()))
      .toBe('02 02 00 01 c8 00 01 01 10 00 02 01 08 00')
  })

  it('builds the ACC stop command as 03 <type>', () => {
    expect(hex(buildAccStopCommand())).toBe(`03 0${PMD_MEAS_ACC}`)
  })

  it('builds the get-settings command as 01 <type>', () => {
    expect(hex(buildGetSettingsCommand(PMD_MEAS_ACC))).toBe('01 02')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/live-hr/__tests__/pmd-control.test.ts`
Expected: FAIL — `Cannot find module '@/lib/live-hr/pmd-control'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/live-hr/pmd-control.ts
// Polar PMD (Polar Measurement Data) Control-Point command builders. See the
// polar-h10-ble skill §3. The Control Point (Write + Indicate) starts/stops a stream;
// sample frames then arrive on the Data characteristic (Notify).
//
// These command bytes are cross-corroborated across four open implementations but were
// NOT extracted from the SDK's PMD spec PDF — the on-device task (Phase 4/6) confirms the
// H10 accepts them and reports the granted settings via get-settings before we trust them.

export const PMD_SERVICE = 'fb005c80-02e7-f387-1cad-8acd2d8df0c8'
export const PMD_CONTROL_POINT = 'fb005c81-02e7-f387-1cad-8acd2d8df0c8'
export const PMD_DATA = 'fb005c82-02e7-f387-1cad-8acd2d8df0c8'

/** Control-point op codes (byte 0). */
export const PMD_OP_GET_SETTINGS = 0x01
export const PMD_OP_START = 0x02
export const PMD_OP_STOP = 0x03

/** Measurement types (byte 1). Only ACC is used by this spike. */
export const PMD_MEAS_ACC = 0x02

/**
 * Start accelerometer: 200 Hz, 16-bit resolution, ±8 G.
 * Layout: [op=0x02][type=0x02] then settings TLVs [type:1][len:1][value:2 LE]:
 *   0x00 sample rate  = 0x00C8 (200)
 *   0x01 resolution   = 0x0010 (16)
 *   0x02 range G      = 0x0008 (8)
 */
export function buildAccStartCommand(): Uint8Array {
  return new Uint8Array([
    PMD_OP_START, PMD_MEAS_ACC,
    0x00, 0x01, 0xc8, 0x00, // rate 200
    0x01, 0x01, 0x10, 0x00, // resolution 16
    0x02, 0x01, 0x08, 0x00, // range ±8 G
  ])
}

/** Stop the accelerometer stream: [op=0x03][type=0x02]. */
export function buildAccStopCommand(): Uint8Array {
  return new Uint8Array([PMD_OP_STOP, PMD_MEAS_ACC])
}

/** Query the settings the ring will grant for a measurement type: [op=0x01][type]. */
export function buildGetSettingsCommand(measType: number): Uint8Array {
  return new Uint8Array([PMD_OP_GET_SETTINGS, measType])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/live-hr/__tests__/pmd-control.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/live-hr/pmd-control.ts lib/live-hr/__tests__/pmd-control.test.ts
git commit -m "Add PMD control-point command builders for H10 accelerometer spike

The H10 exposes no cadence metric; deriving it needs the raw accelerometer over
the proprietary PMD service. These are the start/stop/get-settings commands, kept
pure so they are unit-testable without the native BLE plugin."
```

---

## Phase 2 — PMD ACC frame decoder (SANDBOX-TESTABLE)

Data frames carry a common header then samples. Per skill §3 the H10 emits **either** raw (frame-type byte `0x00`/`0x01`, 6-byte int16 LE per sample) **or** delta-compressed (`0x02`) frames depending on rate/resolution — **branch on the frame-type byte, never assume** (§8 risk 1). Both are decoded here.

### Task 2: Decode raw (uncompressed) ACC frames

**Files:**
- Create: `lib/live-hr/pmd-accel.ts`
- Test: `lib/live-hr/__tests__/pmd-accel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/live-hr/__tests__/pmd-accel.test.ts
import { describe, it, expect } from 'vitest'
import { decodePmdAccFrame, magnitude } from '@/lib/live-hr/pmd-accel'

// PMD ACC data-frame layout (skill §3):
//   [0]      measurement type (0x02 = ACC)
//   [1..8]   uint64 LE timestamp (ns, at the LAST sample)
//   [9]      frame type (0x00/0x01 = raw; 0x02 = delta)
//   [10..]   samples
const bytes = (...b: number[]) => new Uint8Array(b)

describe('decodePmdAccFrame — raw frames', () => {
  it('decodes two raw int16-LE milli-g samples (frame type 0x00)', () => {
    const frame = bytes(
      0x02,                                  // ACC
      0x01, 0, 0, 0, 0, 0, 0, 0,             // timestamp = 1 ns
      0x00,                                  // raw frame type
      0x64, 0x00, 0x38, 0xff, 0xe8, 0x03,    // x=100, y=-200, z=1000
      0x9c, 0xff, 0xc8, 0x00, 0x00, 0x04,    // x=-100, y=200, z=1024
    )
    const decoded = decodePmdAccFrame(frame)
    expect(decoded).not.toBeNull()
    expect(decoded!.frameType).toBe(0x00)
    expect(decoded!.timestampNs).toBe(1n)
    expect(decoded!.samples).toEqual([
      { x: 100, y: -200, z: 1000 },
      { x: -100, y: 200, z: 1024 },
    ])
  })

  it('returns null for a non-ACC measurement type', () => {
    expect(decodePmdAccFrame(bytes(0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0x00))).toBeNull()
  })

  it('returns null for a truncated frame (no samples)', () => {
    expect(decodePmdAccFrame(bytes(0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0x00))).toBeNull()
  })

  it('magnitude is the Euclidean norm of a sample', () => {
    expect(magnitude({ x: 3, y: 0, z: 4 })).toBe(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/live-hr/__tests__/pmd-accel.test.ts`
Expected: FAIL — `Cannot find module '@/lib/live-hr/pmd-accel'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/live-hr/pmd-accel.ts
// Pure decoder for Polar PMD accelerometer DATA frames (skill §3). Infallible:
// returns null for anything malformed and never throws (Oura-pipeline rule).
//
// The raw-count → milli-g scale and the frame type the H10 actually emits at
// 200 Hz / 16-bit / ±8 G are confirmed on-device against a captured vector before
// this is trusted (skill §8 risks 1 & 3). Samples are the ring's reported int16
// milli-g values as-is.

export interface PmdAccSample { x: number; y: number; z: number }

export interface PmdAccFrame {
  /** uint64 LE device-epoch nanoseconds, stamped at the LAST sample of the frame. */
  timestampNs: bigint
  frameType: number
  samples: PmdAccSample[]
}

const ACC_MEAS_TYPE = 0x02
const HEADER_LEN = 10

export function magnitude(s: PmdAccSample): number {
  return Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z)
}

function int16LE(b: Uint8Array, i: number): number {
  const v = b[i] | (b[i + 1] << 8)
  return v > 0x7fff ? v - 0x10000 : v
}

/** Decode a full PMD ACC data frame (header included). null if malformed. */
export function decodePmdAccFrame(frame: Uint8Array): PmdAccFrame | null {
  if (frame.length < HEADER_LEN || frame[0] !== ACC_MEAS_TYPE) return null
  const timestampNs = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getBigUint64(1, true)
  const frameType = frame[9]
  const samples: PmdAccSample[] = []
  // Raw frame (0x00 / 0x01): consecutive [x,y,z] int16 LE, 6 bytes each.
  for (let i = HEADER_LEN; i + 6 <= frame.length; i += 6) {
    samples.push({ x: int16LE(frame, i), y: int16LE(frame, i + 2), z: int16LE(frame, i + 4) })
  }
  if (samples.length === 0) return null
  return { timestampNs, frameType, samples }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/live-hr/__tests__/pmd-accel.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/live-hr/pmd-accel.ts lib/live-hr/__tests__/pmd-accel.test.ts
git commit -m "Decode raw PMD accelerometer frames into milli-g samples

Infallible decoder (null on malformed, never throws) for the uncompressed PMD ACC
frame the H10 may emit. The delta-compressed variant is added next."
```

### Task 3: Decode delta-compressed ACC frames (frame type 0x02)

Delta frames pack a full reference sample, then groups of bit-packed signed cumulative deltas. Layout per skill §3 + Polar PMD delta encoding: after the 10-byte header — reference sample (3 × int16 LE, 6 bytes), then repeated groups `[bitWidth:1][sampleCount:1][packed deltas]`, each delta LSB-first, sign-extended at `bitWidth`, applied cumulatively across x/y/z.

**Files:**
- Modify: `lib/live-hr/pmd-accel.ts`
- Test: `lib/live-hr/__tests__/pmd-accel.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing file)**

```ts
// append to lib/live-hr/__tests__/pmd-accel.test.ts
describe('decodePmdAccFrame — delta frames', () => {
  it('decodes a reference sample + one cumulative delta group (frame type 0x02)', () => {
    // Reference (1000, 0, -1000); group bitWidth=4 count=1 deltas (+1,+1,+1) → (1001,1,-999).
    // 4-bit deltas x,y,z packed LSB-first: x=0001 y=0001 → 0x11, z=0001 → 0x01.
    const frame = bytes(
      0x02,                               // ACC
      0x02, 0, 0, 0, 0, 0, 0, 0,          // timestamp = 2 ns
      0x02,                               // delta frame type
      0xe8, 0x03, 0x00, 0x00, 0x18, 0xfc, // reference: 1000, 0, -1000
      0x04, 0x01, 0x11, 0x01,             // bitWidth=4, count=1, packed deltas
    )
    const decoded = decodePmdAccFrame(frame)
    expect(decoded).not.toBeNull()
    expect(decoded!.frameType).toBe(0x02)
    expect(decoded!.samples).toEqual([
      { x: 1000, y: 0, z: -1000 },
      { x: 1001, y: 1, z: -999 },
    ])
  })

  it('sign-extends negative deltas', () => {
    // Reference (0,0,0); bitWidth=4 count=1 deltas (-1,-1,-1). 4-bit -1 = 0b1111.
    // packed LSB-first: x=1111 y=1111 → 0xff, z=1111 → 0x0f.
    const frame = bytes(
      0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0x02,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reference 0,0,0
      0x04, 0x01, 0xff, 0x0f,
    )
    const decoded = decodePmdAccFrame(frame)
    expect(decoded!.samples).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: -1, y: -1, z: -1 },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/live-hr/__tests__/pmd-accel.test.ts`
Expected: FAIL — the delta frame currently decodes the reference bytes as raw samples, so `samples` is wrong / lengths mismatch.

- [ ] **Step 3: Update the implementation to branch on frame type**

Replace the sample-building section of `decodePmdAccFrame` (the raw `for` loop through `return`) with a frame-type branch, and add the two helpers below it:

```ts
// in lib/live-hr/pmd-accel.ts — replace the raw for-loop + return with:
  const samples: PmdAccSample[] = []
  if (frameType === 0x02) {
    if (!decodeDelta(frame, HEADER_LEN, samples)) return null
  } else {
    for (let i = HEADER_LEN; i + 6 <= frame.length; i += 6) {
      samples.push({ x: int16LE(frame, i), y: int16LE(frame, i + 2), z: int16LE(frame, i + 4) })
    }
  }
  if (samples.length === 0) return null
  return { timestampNs, frameType, samples }
}

/** Read `width` bits from `b` starting at absolute bit position `bitPos`, LSB-first,
 *  and sign-extend the result to a signed JS number. */
function readSignedBits(b: Uint8Array, bitPos: number, width: number): number {
  let v = 0
  for (let k = 0; k < width; k++) {
    const abs = bitPos + k
    const bit = (b[abs >> 3] >> (abs & 7)) & 1
    v |= bit << k
  }
  const signBit = 1 << (width - 1)
  return v & signBit ? v - (1 << width) : v
}

/** Delta-compressed body: reference sample (3×int16 LE) then [bitWidth][count][packed]
 *  groups of cumulative x/y/z deltas. Returns false if malformed. */
function decodeDelta(frame: Uint8Array, start: number, out: PmdAccSample[]): boolean {
  let off = start
  if (off + 6 > frame.length) return false
  let cur: PmdAccSample = { x: int16LE(frame, off), y: int16LE(frame, off + 2), z: int16LE(frame, off + 4) }
  off += 6
  out.push({ ...cur })
  while (off + 2 <= frame.length) {
    const bitWidth = frame[off]
    const count = frame[off + 1]
    off += 2
    if (bitWidth === 0 || count === 0) break
    const totalBytes = Math.ceil((bitWidth * 3 * count) / 8)
    if (off + totalBytes > frame.length) return false
    let bitPos = off * 8
    for (let s = 0; s < count; s++) {
      const dx = readSignedBits(frame, bitPos, bitWidth); bitPos += bitWidth
      const dy = readSignedBits(frame, bitPos, bitWidth); bitPos += bitWidth
      const dz = readSignedBits(frame, bitPos, bitWidth); bitPos += bitWidth
      cur = { x: cur.x + dx, y: cur.y + dy, z: cur.z + dz }
      out.push({ ...cur })
    }
    off += totalBytes
  }
  return true
}
```

- [ ] **Step 4: Run test to verify all pass**

Run: `npx vitest run lib/live-hr/__tests__/pmd-accel.test.ts`
Expected: PASS (6 tests — raw + delta).

- [ ] **Step 5: Commit**

```bash
git add lib/live-hr/pmd-accel.ts lib/live-hr/__tests__/pmd-accel.test.ts
git commit -m "Decode delta-compressed PMD accelerometer frames

The H10 emits raw or delta frames depending on rate/resolution; branch on the
frame-type byte and unpack bit-packed cumulative deltas. Synthetic vectors here are
placeholders for a real on-device capture, per the pin-a-vector rule."
```

> **Note for the implementer:** the synthetic delta vector encodes the group header as `[bitWidth][count]`. Polar's field-level docs are ambiguous on that byte order (skill §3 says "count + per-axis bit width"). The on-device capture task (Phase 6) is where this is confirmed against a real frame and the decoder corrected if the real order is `[count][bitWidth]`.

---

## Phase 3 — Cadence DSP (SANDBOX-TESTABLE)

Cadence is a **rhythm frequency**, so band-limited autocorrelation on the acceleration magnitude is the right tool (same primitive as `lib/oura-ble/gait-step-count.ts:gaitBandAutocorr`, retuned for the running band). Magnitude is orientation-independent, so it works regardless of how the pod sits on the chest. Running cadence is ~150–190 spm (2.5–3.17 Hz); we search a slightly wider band (2.0–3.6 Hz = 120–216 spm) to catch slow jogs and fast strides.

### Task 4: `detectCadence` — steps/min from an accel-magnitude window

**Files:**
- Create: `lib/live-hr/cadence-detect.ts`
- Test: `lib/live-hr/__tests__/cadence-detect.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/live-hr/__tests__/cadence-detect.test.ts
import { describe, it, expect } from 'vitest'
import { detectCadence, RUN_CADENCE_MIN_HZ, RUN_CADENCE_MAX_HZ } from '@/lib/live-hr/cadence-detect'

const SAMPLE_RATE = 200

/** Synthetic footfall signal: a sine at `stepHz` steps/sec over `seconds`, plus a DC
 *  offset (gravity) and light noise — a stand-in for real vertical acceleration. */
function synthRun(stepHz: number, seconds: number, rate = SAMPLE_RATE): number[] {
  const n = Math.round(seconds * rate)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i / rate
    out.push(1000 + 400 * Math.sin(2 * Math.PI * stepHz * t) + ((i * 37) % 11) - 5)
  }
  return out
}

describe('detectCadence', () => {
  it('recovers 180 spm (3.0 Hz) within ±3 spm from a clean signal', () => {
    const est = detectCadence(synthRun(3.0, 8), SAMPLE_RATE)
    expect(est).not.toBeNull()
    expect(est!.cadenceSpm).toBeGreaterThanOrEqual(177)
    expect(est!.cadenceSpm).toBeLessThanOrEqual(183)
    expect(est!.strength).toBeGreaterThan(0.5)
  })

  it('recovers 156 spm (2.6 Hz) within ±3 spm', () => {
    const est = detectCadence(synthRun(2.6, 8), SAMPLE_RATE)
    expect(est!.cadenceSpm).toBeGreaterThanOrEqual(153)
    expect(est!.cadenceSpm).toBeLessThanOrEqual(159)
  })

  it('returns null for aperiodic / non-running motion (no rhythm)', () => {
    const noise = Array.from({ length: 1600 }, (_, i) => 1000 + ((i * 131) % 900) - 450)
    expect(detectCadence(noise, SAMPLE_RATE)).toBeNull()
  })

  it('returns null for a too-short window', () => {
    expect(detectCadence(synthRun(3.0, 0.3), SAMPLE_RATE)).toBeNull()
  })

  it('exposes the running cadence band it searches', () => {
    expect(RUN_CADENCE_MIN_HZ).toBeLessThan(RUN_CADENCE_MAX_HZ)
    expect(RUN_CADENCE_MAX_HZ).toBeLessThanOrEqual(3.6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/live-hr/__tests__/cadence-detect.test.ts`
Expected: FAIL — `Cannot find module '@/lib/live-hr/cadence-detect'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/live-hr/cadence-detect.ts
// Running-cadence DSP for the H10 accelerometer spike. The H10 exposes NO cadence
// metric over BLE (skill §0) — this IS our own signal processing. One-Formula-One-Place:
// the admin console, any future live readout, and any promoted feature share this module.
//
// Cadence is a rhythm frequency, so we take the strongest normalized autocorrelation of
// the detrended magnitude within the running band. Magnitude (not a single axis) is used
// so the estimate is independent of how the pod sits on the chest. Same primitive as the
// proven gait autocorrelation in lib/oura-ble/gait-step-count.ts, retuned for running.
//
// STATUS: constants are seeded from the literature and the gait module; they are TUNED
// against real treadmill captures on-device (Phase 6) before any GO decision.

/** Running cadence search band (Hz = steps/sec). 2.0–3.6 Hz = 120–216 steps/min. */
export const RUN_CADENCE_MIN_HZ = 2.0
export const RUN_CADENCE_MAX_HZ = 3.6

/** Minimum window to resolve a ~2 Hz rhythm reliably (~2 s). */
export const MIN_WINDOW_SEC = 2
/** Rhythm-strength gate: below this the window is not a run (mirrors the gait gate). */
export const CADENCE_STRENGTH_GATE = 0.4

export interface CadenceEstimate {
  /** Steps per minute. */
  cadenceSpm: number
  /** Normalized autocorrelation peak (0..~1) — rhythm confidence. */
  strength: number
}

/**
 * Estimate running cadence (steps/min) from a window of accel-MAGNITUDE samples.
 * Returns null when the window is too short or carries no running rhythm.
 */
export function detectCadence(magnitudes: number[], sampleRate: number): CadenceEstimate | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null
  if (magnitudes.length < MIN_WINDOW_SEC * sampleRate) return null

  const lagMin = Math.max(1, Math.round(sampleRate / RUN_CADENCE_MAX_HZ))
  const lagMax = Math.round(sampleRate / RUN_CADENCE_MIN_HZ)

  const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length
  const x = magnitudes.map(v => v - mean)
  const denom = x.reduce((a, b) => a + b * b, 0) || 1

  let bestR = 0
  let bestLag = 0
  for (let lag = lagMin; lag <= lagMax && lag < x.length; lag++) {
    let acc = 0
    for (let i = 0; i + lag < x.length; i++) acc += x[i] * x[i + lag]
    const r = acc / denom
    if (r > bestR) { bestR = r; bestLag = lag }
  }

  if (bestLag === 0 || bestR < CADENCE_STRENGTH_GATE) return null
  const stepHz = sampleRate / bestLag
  return { cadenceSpm: Math.round(stepHz * 60), strength: Number(bestR.toFixed(3)) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/live-hr/__tests__/cadence-detect.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/live-hr/cadence-detect.ts lib/live-hr/__tests__/cadence-detect.test.ts
git commit -m "Add running-cadence DSP (band-limited autocorrelation)

The H10 exposes no cadence metric, so cadence is our own signal processing. Estimates
steps/min from an accel-magnitude window; constants seeded now and tuned against real
treadmill captures on-device before any go/no-go."
```

### Task 5: `countRunSteps` — secondary step-count by-product

Cadence is the target; step count is a by-product. A run's steps ≈ peaks counted while a cadence rhythm is present, gated by the same rhythm test (mirrors `countGaitGatedSteps`).

**Files:**
- Modify: `lib/live-hr/cadence-detect.ts`
- Test: `lib/live-hr/__tests__/cadence-detect.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
// append to lib/live-hr/__tests__/cadence-detect.test.ts
import { countRunSteps } from '@/lib/live-hr/cadence-detect'

describe('countRunSteps (secondary by-product)', () => {
  it('counts ~1 step per footfall period over a clean run window', () => {
    // 3.0 Hz for 10 s ⇒ ~30 footfall periods.
    const n = detectCadence(synthRun(3.0, 10), SAMPLE_RATE)!
    const steps = countRunSteps(synthRun(3.0, 10), SAMPLE_RATE)
    expect(n.cadenceSpm).toBeGreaterThan(170)
    expect(steps).toBeGreaterThanOrEqual(27)
    expect(steps).toBeLessThanOrEqual(33)
  })

  it('returns 0 for aperiodic motion (no run rhythm)', () => {
    const noise = Array.from({ length: 2000 }, (_, i) => 1000 + ((i * 131) % 900) - 450)
    expect(countRunSteps(noise, SAMPLE_RATE)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/live-hr/__tests__/cadence-detect.test.ts`
Expected: FAIL — `countRunSteps` is not exported.

- [ ] **Step 3: Add the implementation (append to `cadence-detect.ts`)**

```ts
// append to lib/live-hr/cadence-detect.ts

/** EMA baseline factor + relative peak threshold (mirrors lib/oura-ble/accel.ts). */
const BASELINE_ALPHA = 0.08
const PEAK_RATIO = 0.12
/** Refractory: max plausible running cadence ~3.6 Hz ⇒ min 1/3.6 s between steps. */
const MIN_STEP_GAP_SEC = 1 / (RUN_CADENCE_MAX_HZ + 0.4)
/** Analysis window / hop for the run-rhythm gate (~2 s / ~0.5 s). */
const GATE_WINDOW_SEC = 2
const GATE_HOP_SEC = 0.5

/**
 * Secondary: count steps over a captured run window. Peak-counts the magnitude only
 * where a running rhythm is present (per-window detectCadence gate), refractory-limited.
 * Under-counts on start/stop ramps — the safe direction — never runs away like a raw count.
 */
export function countRunSteps(magnitudes: number[], sampleRate: number): number {
  const n = magnitudes.length
  if (n === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) return 0

  const win = Math.round(GATE_WINDOW_SEC * sampleRate)
  const hop = Math.max(1, Math.round(GATE_HOP_SEC * sampleRate))
  const running = new Array<boolean>(n).fill(false)
  for (let s = 0; s + win <= n; s += hop) {
    const periodic = detectCadence(magnitudes.slice(s, s + win), sampleRate) !== null
    for (let i = s; i < s + win && i < n; i++) running[i] = running[i] || periodic
  }

  const refractory = Math.max(1, Math.round(sampleRate * MIN_STEP_GAP_SEC))
  let baseline = 0, prevDeviation = 0, lastPeakAt = -Infinity, count = 0
  let rising = false
  for (let i = 0; i < n; i++) {
    const m = magnitudes[i]
    if (baseline === 0) { baseline = m; continue }
    baseline += BASELINE_ALPHA * (m - baseline)
    const deviation = m - baseline
    if (deviation > prevDeviation) {
      rising = deviation > baseline * PEAK_RATIO
    } else if (rising) {
      rising = false
      if (running[i] && i - lastPeakAt >= refractory) { count++; lastPeakAt = i }
    }
    prevDeviation = deviation
  }
  return count
}
```

- [ ] **Step 4: Run test to verify all pass**

Run: `npx vitest run lib/live-hr/__tests__/cadence-detect.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/live-hr/cadence-detect.ts lib/live-hr/__tests__/cadence-detect.test.ts
git commit -m "Add run step-count by-product gated by cadence rhythm

Step count is secondary to cadence; peak-count only inside a detected run rhythm so
it under-counts on ramps rather than running away. Ambient daily steps stay on Oura."
```

### Task 6: Full pure-module gate

- [ ] **Step 1: Run the whole suite + typecheck + lint (the sandbox-verifiable gate)**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green; the three new test files (Phases 1–3) pass and nothing else regresses.

- [ ] **Step 2: No commit** (verification only — nothing changed).

---

## Phase 4 — PMD accelerometer BLE stream (DEVICE-ONLY — owner APK rebuild required)

> **DEVICE-ONLY.** `@capacitor-community/bluetooth-le` is a native plugin; `getBle()` returns `null` off-device, so this module is inert in the sandbox and CANNOT be exercised by `pnpm dev`/`pnpm test`. It ships only after `npx cap sync android && ./gradlew assembleDebug` and is verified on the S25 APK (Canonical Runtime rules). CI can only typecheck/lint it.

### Task 7: `PmdAccelStream` — drive the PMD service and forward decoded samples

**Files:**
- Create: `lib/live-hr/pmd-accel-stream.ts`

- [ ] **Step 1: Write the module** (no unit test — it is BLE-bound; the pure decoder it delegates to is already tested)

```ts
// lib/live-hr/pmd-accel-stream.ts
// DEVICE-ONLY. Drives the Polar PMD accelerometer stream over the community BLE plugin
// and forwards decoded samples. Standard-GATT HR (chest-strap-source.ts) is unaffected —
// this is an ADDITIONAL stream, started only for a run capture in the spike.
//
// Nothing here runs in the sandbox: getBle() returns null off-device (mirrors
// chest-strap-source.ts). On-device is the only real verification (skill §8 risk 5).
import { numbersToDataView } from '@capacitor-community/bluetooth-le'
import { decodePmdAccFrame, type PmdAccSample } from '@/lib/live-hr/pmd-accel'
import {
  PMD_SERVICE, PMD_CONTROL_POINT, PMD_DATA,
  buildAccStartCommand, buildAccStopCommand,
} from '@/lib/live-hr/pmd-control'

async function getBle() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    const { BleClient } = await import('@capacitor-community/bluetooth-le')
    return BleClient
  } catch { return null }
}

export interface PmdStreamCallbacks {
  onSamples: (samples: PmdAccSample[], timestampNs: bigint) => void
  onError?: (message: string) => void
}

export class PmdAccelStream {
  private deviceId: string | null = null
  private running = false

  constructor(private readonly callbacks: PmdStreamCallbacks) {}

  isRunning() { return this.running }

  /** Start the 200 Hz ACC stream on an ALREADY-CONNECTED device (the HR source owns the
   *  connection). Enables Control-Point indications + Data notifications, then writes start. */
  async start(deviceId: string): Promise<void> {
    const ble = await getBle()
    if (!ble) { this.callbacks.onError?.('Native BLE unavailable (web sandbox).'); return }
    this.deviceId = deviceId
    try {
      // Control Point is Indicate; the plugin surfaces indications through startNotifications.
      await ble.startNotifications(deviceId, PMD_SERVICE, PMD_CONTROL_POINT, () => { /* ack/settings — ignored in the spike */ })
      await ble.startNotifications(deviceId, PMD_SERVICE, PMD_DATA, value => {
        const frame = decodePmdAccFrame(new Uint8Array(value.buffer))
        if (!frame) return // infallible decoder: drop malformed, never throw
        this.callbacks.onSamples(frame.samples, frame.timestampNs)
      })
      await ble.write(deviceId, PMD_SERVICE, PMD_CONTROL_POINT, numbersToDataView(Array.from(buildAccStartCommand())))
      this.running = true
    } catch (e) {
      this.running = false
      this.callbacks.onError?.(e instanceof Error ? e.message : String(e))
    }
  }

  /** Stop the stream. Best-effort — the HR connection stays up for the caller. */
  async stop(): Promise<void> {
    this.running = false
    const ble = await getBle()
    if (!ble || !this.deviceId) return
    const id = this.deviceId
    try { await ble.write(id, PMD_SERVICE, PMD_CONTROL_POINT, numbersToDataView(Array.from(buildAccStopCommand()))) } catch { /* gone */ }
    try { await ble.stopNotifications(id, PMD_SERVICE, PMD_DATA) } catch { /* gone */ }
    try { await ble.stopNotifications(id, PMD_SERVICE, PMD_CONTROL_POINT) } catch { /* gone */ }
    this.deviceId = null
  }
}
```

- [ ] **Step 2: Verify it typechecks + lints** (the only sandbox check possible)

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. `numbersToDataView` and `BleClient` resolve from `@capacitor-community/bluetooth-le` (already a dependency, used in `chest-strap-source.ts`).

- [ ] **Step 3: Commit**

```bash
git add lib/live-hr/pmd-accel-stream.ts
git commit -m "Add device-only PMD accelerometer BLE stream wrapper

Drives the H10 PMD service to stream 200 Hz accelerometer and forwards decoded
samples. Additional to the standard HR service, not a replacement. BLE is inert in
the sandbox; on-device is the only real verification."
```

---

## Phase 5 — Admin capture & tuning console (DEVICE-ONLY UI)

> **DEVICE-ONLY behaviour.** The page renders in `pnpm dev` (so the route can be smoke-checked), but the stream is inert there — the console shows "Native plugin unavailable" off-device, exactly like `OuraBleDebug`. Capture/tuning is only meaningful on the APK. **No DB migration** — captures are exported as JSON + retried via `localStorage`, mirroring `components/oura-ble/live-step-test.tsx`.

### Task 8: The cadence-spike console component

**Files:**
- Create: `components/chest-strap/cadence-spike-console.tsx`

- [ ] **Step 1: Write the component**

```tsx
// components/chest-strap/cadence-spike-console.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, BluetoothOff, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopy } from '@/lib/use-copy'
import { getPairedStrap } from '@/lib/live-hr/paired-strap'
import { HR_SERVICE } from '@/lib/live-hr/chest-strap-source'
import { PmdAccelStream } from '@/lib/live-hr/pmd-accel-stream'
import { magnitude, type PmdAccSample } from '@/lib/live-hr/pmd-accel'
import { detectCadence, countRunSteps } from '@/lib/live-hr/cadence-detect'

const SAMPLE_RATE = 200
// ~30 s of 200 Hz magnitude — enough to characterise a run window without unbounded memory.
const MAX_SAMPLES = SAMPLE_RATE * 30
const PENDING_KEY = 'ta-h10-cadence-pending'

interface Capture { startedAt: string; endedAt: string; realCadenceSpm: number | null; estCadenceSpm: number | null; steps: number; sampleRate: number; n: number }

function readPending(): Capture[] { try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') } catch { return [] } }
function writePending(items: Capture[]) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(items)) } catch { /* storage unavailable */ } }

export function CadenceSpikeConsole() {
  const [available, setAvailable] = useState<'checking' | 'unavailable' | 'ready'>('checking')
  const [running, setRunning] = useState(false)
  const [frames, setFrames] = useState(0)
  const [liveCadence, setLiveCadence] = useState<{ spm: number; strength: number } | null>(null)
  const [note, setNote] = useState('')
  const [realCadence, setRealCadence] = useState('')
  const [captureJson, setCaptureJson] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const { copied, copy } = useCopy()

  const streamRef = useRef<PmdAccelStream | null>(null)
  const magsRef = useRef<number[]>([])
  const startedAtRef = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { Capacitor } = await import('@capacitor/core')
      if (cancelled) return
      setAvailable(Capacitor.isNativePlatform() && getPairedStrap() ? 'ready' : 'unavailable')
    })()
    setPendingCount(readPending().length)
    return () => { cancelled = true }
  }, [])

  const onSamples = useCallback((samples: PmdAccSample[]) => {
    const buf = magsRef.current
    for (const s of samples) buf.push(Math.round(magnitude(s)))
    if (buf.length > MAX_SAMPLES) buf.splice(0, buf.length - MAX_SAMPLES)
    setFrames(n => n + 1)
    // Live estimate over the most recent ~4 s.
    const recent = buf.slice(-SAMPLE_RATE * 4)
    const est = detectCadence(recent, SAMPLE_RATE)
    setLiveCadence(est ? { spm: est.cadenceSpm, strength: est.strength } : null)
  }, [])

  const start = useCallback(async () => {
    const paired = getPairedStrap()
    if (!paired) { setNote('Pair the H10 in Settings first.'); return }
    magsRef.current = []
    setFrames(0); setLiveCadence(null); setCaptureJson(null)
    startedAtRef.current = Date.now()
    const stream = new PmdAccelStream({ onSamples, onError: m => setNote(`stream error: ${m}`) })
    streamRef.current = stream
    setRunning(true)
    setNote('Streaming accel. Run at a steady, counted cadence. No frames after ~10 s means the PMD stream is not delivering — report that.')
    await stream.start(paired.deviceId)
  }, [onSamples])

  const stop = useCallback(async () => {
    setRunning(false)
    await streamRef.current?.stop()
    streamRef.current = null
    const mags = magsRef.current
    const est = detectCadence(mags, SAMPLE_RATE)
    const cap: Capture = {
      startedAt: startedAtRef.current ? new Date(startedAtRef.current).toISOString() : new Date().toISOString(),
      endedAt: new Date().toISOString(),
      realCadenceSpm: realCadence.trim() ? Number(realCadence) : null,
      estCadenceSpm: est?.cadenceSpm ?? null,
      steps: countRunSteps(mags, SAMPLE_RATE),
      sampleRate: SAMPLE_RATE,
      n: mags.length,
    }
    setNote(`Stopped. Est cadence ${cap.estCadenceSpm ?? '—'} spm vs your count ${cap.realCadenceSpm ?? '—'} · steps ${cap.steps}. Copy the JSON and record both.`)
    setCaptureJson(JSON.stringify({ ...cap, magnitudes: mags }))
    if (cap.estCadenceSpm != null) { const next = [...readPending(), cap]; writePending(next); setPendingCount(next.length) }
  }, [realCadence])

  const copyCapture = useCallback(() => copy(captureJson ?? '', textareaRef.current), [copy, captureJson])
  const clearPending = useCallback(() => { writePending([]); setPendingCount(0) }, [])

  if (available === 'checking') return <p className="text-sm text-muted-foreground">Checking native plugin…</p>
  if (available === 'unavailable') {
    return (
      <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-4">
        <BluetoothOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Chest-strap accelerometer needs the APK and a paired H10. Pair it in Settings, then open
          this screen in an APK built after this plugin landed (<code>npx cap sync android</code> +{' '}
          <code>./gradlew assembleDebug</code>).
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-md border border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text" inputMode="numeric" placeholder="real cadence (spm)"
            value={realCadence} onChange={e => setRealCadence(e.target.value.replace(/[^0-9]/g, ''))}
            disabled={running}
            className="h-9 w-40 rounded-md border border-input bg-transparent px-2 text-sm"
          />
          {running
            ? <Button size="sm" variant="destructive" onClick={stop}><Square className="mr-1 h-4 w-4" /> Stop</Button>
            : <Button size="sm" onClick={start}><Play className="mr-1 h-4 w-4" /> Start run capture</Button>}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Live cadence" value={liveCadence ? `${liveCadence.spm}` : '—'} unit="spm" />
          <Stat label="Rhythm" value={liveCadence ? liveCadence.strength.toFixed(2) : '—'} unit="" />
          <Stat label="Frames" value={`${frames}`} unit="" />
        </div>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </section>

      {captureJson && (
        <section className="space-y-2 rounded-md border border-border p-4">
          <h2 className="flex items-center gap-2 text-sm font-medium"><Activity className="h-4 w-4" /> Capture</h2>
          <p className="text-xs text-muted-foreground">Copy this and paste it into the tuning notes / plan — it holds the raw magnitudes for offline retuning of <code>cadence-detect.ts</code>.</p>
          <Button size="sm" onClick={copyCapture}>{copied ? 'Copied ✓' : 'Copy capture JSON'}</Button>
          <textarea
            ref={textareaRef} readOnly spellCheck={false} value={captureJson}
            onFocus={e => e.currentTarget.select()}
            className="h-32 w-full rounded-md border border-input bg-transparent p-2 font-mono text-[10px]"
          />
        </section>
      )}

      {pendingCount > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{pendingCount} capture(s) saved locally.</span>
          <Button size="sm" variant="ghost" onClick={clearPending}>Clear</Button>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <div className="text-lg font-semibold tabular-nums text-foreground">{value}<span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span></div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it typechecks + lints**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (`useCopy` is the existing hook used by `live-step-test.tsx`; theme tokens only — no hex literals, no emoji, Lucide icons.)

- [ ] **Step 3: Commit**

```bash
git add components/chest-strap/cadence-spike-console.tsx
git commit -m "Add admin cadence-spike capture console

Streams the H10 accelerometer, shows a live cadence estimate, and exports raw
magnitudes for offline retuning. No DB table — captures export as JSON + a local
retry buffer, mirroring the Oura live-step tester."
```

### Task 9: The admin page

**Files:**
- Create: `app/admin/chest-strap/page.tsx`

- [ ] **Step 1: Write the page** (mirrors `app/admin/oura-ble/page.tsx` — admin gate + safe-area header + BottomNav)

```tsx
// app/admin/chest-strap/page.tsx
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isAdminUser } from '@/lib/admin'
import { CadenceSpikeConsole } from '@/components/chest-strap/cadence-spike-console'
import { BottomNav } from '@/components/shell/bottom-nav'

export default async function ChestStrapSpikePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  if (!await isAdminUser(session.user.id)) redirect('/')

  return (
    <>
      <main className="pt-safe-or-4 mx-auto max-w-lg px-4 pb-24">
        <h1 className="mb-1 text-lg font-semibold">Chest strap — cadence spike</h1>
        <p className="mb-4 text-xs text-muted-foreground">
          De-risk deriving running cadence from the H10 accelerometer. Admin-only, not a shipped
          feature. Streaming is 200 Hz — use it only for a run capture, never during weights or wear.
        </p>
        <CadenceSpikeConsole />
      </main>
      <BottomNav isAdmin />
    </>
  )
}
```

- [ ] **Step 2: Verify it typechecks + lints, and the route renders in dev**

Run: `pnpm typecheck && pnpm lint`
Then: `pnpm dev`, sign in as the admin user (`test@local.dev` locally), open `http://localhost:3000/admin/chest-strap`.
Expected: page renders with the header and the "Native plugin unavailable" card (BLE is inert on web) — confirming the route, admin gate, and layout work. Non-admins are redirected to `/`.

- [ ] **Step 3: Commit**

```bash
git add app/admin/chest-strap/page.tsx
git commit -m "Add admin chest-strap cadence spike page

Admin-gated route hosting the cadence capture console, mirroring the Oura BLE admin
page (safe-area header, bottom nav). Renders on web with the plugin-unavailable card."
```

---

## Phase 6 — On-device capture & tuning (DEVICE-ONLY — the real de-risk)

> **DEVICE-ONLY. Cannot be done in the sandbox.** Requires the owner APK rebuilt (`npx cap sync android && ./gradlew assembleDebug`), a paired H10 worn on the chest (moistened strap, pod snapped in — skill §5), and a treadmill (or a metronome-paced run) as the ground-truth cadence. This is the phase that actually answers the spike.

### Task 10: Confirm the PMD stream delivers and pin a real frame vector

- [ ] **Step 1:** Rebuild the APK, install on the S25, pair the H10 in Settings, open `/admin/chest-strap`, tap **Start run capture** while standing still, then walk.
- [ ] **Step 2:** Confirm the **Frames** counter climbs within ~10 s. Zero frames ⇒ the PMD start command or characteristic UUIDs are wrong (skill §3/§8) — capture the Control-Point response and correct `pmd-control.ts`.
- [ ] **Step 3:** Copy a capture JSON. Inspect the first raw Data frame's byte 9 (frame type): confirm whether the H10 emits **raw** (`0x00`/`0x01`) or **delta** (`0x02`) at 200 Hz / 16-bit / ±8 G (skill §8 risk 1). If delta, verify the group-header byte order against the real frame and correct `decodeDelta` + its test vector if needed. **Pin the real captured frame as a new test vector** in `pmd-accel.test.ts`, replacing the synthetic placeholder — no decoder is trusted until a real vector passes.
- [ ] **Step 4:** Commit any decoder corrections with the pinned real vector.

### Task 11: Tune the cadence DSP against treadmill ground truth

- [ ] **Step 1:** Run **N ≥ 5** treadmill captures at known displayed cadences spanning the band (e.g. 150, 160, 170, 180, 190 spm), each ≥ 60 s. For each, enter the treadmill's cadence into **real cadence (spm)** and copy the capture JSON.
- [ ] **Step 2:** Offline, paste each capture's `magnitudes` into a scratch test and compare `detectCadence` output to the entered ground truth. Retune `RUN_CADENCE_MIN_HZ`/`RUN_CADENCE_MAX_HZ`, `CADENCE_STRENGTH_GATE`, and the window length in `cadence-detect.ts` if the error exceeds the GO threshold — **in that one module** (One-Formula-One-Place).
- [ ] **Step 3:** Add the real captured magnitude arrays as fixtures to `cadence-detect.test.ts` (mirroring the real `WALK_30`/`handwave-0` fixtures in `gait-step-count.test.ts`), asserting each recovers its ground-truth cadence within the tolerance. Re-run `pnpm test`.
- [ ] **Step 4:** Record the per-run error table (real vs estimated spm, and step-count error) in the GO/NO-GO task below.
- [ ] **Step 5:** Commit the real fixtures + any retuned constants.

### Task 12: Battery / thermal impact of a 200 Hz stream

- [ ] **Step 1:** With the strap streaming ACC for a full realistic run duration (e.g. 30–45 min), note the H10 battery % before/after (Settings pairing readout) and whether HR notifications kept arriving throughout (the standard HR service must be unaffected).
- [ ] **Step 2:** Confirm the stream stops cleanly on **Stop** and on navigating away (no lingering 200 Hz drain) — check `PmdAccelStream.stop()` fires and frames cease.
- [ ] **Step 3:** Record the battery delta and any dropout in the GO/NO-GO task.

---

## Phase 7 — GO / NO-GO decision

### Task 13: Write the GO/NO-GO verdict

**Files:**
- This is a **docs-only** task. Record the verdict in the session journal entry for the implementing PR (`docs/overview/entries/YYYY-MM-DD-<branch-slug>.md`, per CLAUDE.md) — **not** by editing `projectOverview.md`/backlog here. If GO, also add a backlog entry for the promotion work (a separate planning PR).

- [ ] **Step 1: Fill in the results table from Phases 6.**

| Check | Threshold (GO) | Measured |
|---|---|---|
| PMD stream delivers frames worn+moving | Frames climb within ~10 s, every run | ☐ |
| Real frame vector pinned | Captured vector passes the decoder test | ☐ |
| Cadence accuracy vs treadmill | Within **±3–5 spm** across **N ≥ 5** runs spanning 150–190 spm | ☐ |
| Rhythm gate rejects non-running | Weights / hand motion / idle ⇒ no cadence (null) | ☐ |
| Step-count by-product | Within ~±10% of a manual count over a run (secondary — not gating) | ☐ |
| Battery impact of 200 Hz stream | Acceptable over a full run; HR service unaffected; stream stops cleanly | ☐ |

- [ ] **Step 2: Decide.**
  - **GO** if cadence lands within **±3–5 spm** across the N runs, the rhythm gate cleanly rejects non-running motion, and the battery cost over a realistic run is acceptable.
  - **NO-GO** (or "needs more work") if cadence is unstable/biased beyond tolerance, the H10 won't deliver the PMD stream reliably worn+moving, or the stream is a heavy battery drain. Record *why* — a NO-GO with the failure signature is a successful de-risk.

- [ ] **Step 3: If GO — describe the promotion work (do NOT implement it here; it becomes a separate planning-PR backlog entry).** Promotion would entail:
  1. **DB migration** adding `cadence` (avg spm) and `cadence_series` (`jsonb` `{ tSec, spm }[]`) columns to `activity_logs` (`lib/data/postgres/schema.ts`) — **claim the migration number then**, against the directory AND open PRs/plans. Update `rowToActivityLog`/SELECT lists + the sync push/pull mapping in the same PR (offline-sync + row-mapper rules).
  2. **Gate the PMD stream to running.** Wire `PmdAccelStream` start/stop to distance-based activity only (`activity_types.is_distance_based`, bounded to an active run) — never weights or ambient wear. The standard HR source stays as-is.
  3. **Surface cadence** on the activity detail screen (avg + a series sparkline — resolve any canvas/chart colours via `resolveColor`, never white/black-alpha literals; pair colour with a label) and, where relevant, wire it into the running-plan.
  4. **Offline-first + device verification** for the new writes (local store + outbox + pull mapping) and the `docs/device-smoke-checklist.md` run.

- [ ] **Step 4: Commit the verdict** in the journal entry (part of the implementing PR).

---

## Verification summary

**Sandbox-verifiable (CI + `pnpm dev` prove these fully):**
- Phase 1 `pmd-control.ts` — command bytes exact-match the skill §3 vectors (`pmd-control.test.ts`).
- Phase 2/3 `pmd-accel.ts` — raw + delta frame decoding against constructed byte vectors (`pmd-accel.test.ts`).
- Phase 3 `cadence-detect.ts` — cadence recovered from synthetic signals within ±3 spm; rhythm gate rejects noise; step-count by-product (`cadence-detect.test.ts`).
- `pnpm test && pnpm typecheck && pnpm lint` green (Phase 1–5 all typecheck/lint).
- Phase 9's admin route renders on web with the "plugin unavailable" card, and the admin gate redirects non-admins (`pnpm dev`).

**NOT sandbox-verifiable — DEVICE-ONLY, S25 APK after owner rebuild (`npx cap sync android && ./gradlew assembleDebug`):**
- The entire BLE path — `PmdAccelStream` connect/write/notify (Phase 4). `getBle()` returns `null` off-device; the community BLE plugin is native. The synthetic decoder vectors are **placeholders** until a real captured frame is pinned (Phase 6, Task 10).
- Whether the H10 actually delivers a PMD ACC stream worn+moving, and whether it emits raw vs delta frames at 200 Hz/16-bit/±8 G (skill §8 risk 1).
- Real cadence accuracy vs a treadmill's displayed cadence (Phase 6, Task 11) — the core de-risk question. Synthetic-signal accuracy in the sandbox is **necessary but not sufficient**.
- Battery/thermal cost of a sustained 200 Hz stream and that the standard HR service is unaffected (Phase 6, Task 12).
- Safe-area insets on the admin page render as 0 on web — the `pt-safe-or-4` header + `pb-24`/`BottomNav` footer are only real on-device.

**Not exercised at all by this spike (out of scope):** any `activity_logs` schema change, offline-sync write path for cadence, and any user-facing surface — those are the promotion step gated on a GO (Task 13).

---

## Self-review (writing-plans)

- **Spec coverage:** cadence-primary framing ✅ (Phase 3, GO threshold); step-count secondary ✅ (Task 5, marked non-gating); gate-to-running/distance-based ✅ (scope note + Task 13 promotion, `is_distance_based` cited); HR service unaffected ✅ (Phases 4/5 notes); reuse `chest-strap-source.ts`/`accel.ts`/`gait-step-count.ts`/`live-step-test.tsx`/`oura-ble/page.tsx` ✅ (cited throughout); PMD protocol from skill §3 ✅ (Phase 1, exact start/stop bytes); admin-panel + raw-storage precedent mirrored ✅ (Phases 5, no-migration note); DSP in one pure module ✅ (`cadence-detect.ts`, One-Formula note); raw-vs-delta branch ✅ (Task 3, branch on byte 9); infallible decoders ✅ (null-return, never-throw); pin captured vector ✅ (Task 10); no migration ✅ (stated, deferred to promotion); GO/NO-GO with criteria + promotion entailment ✅ (Task 13). Device-only tasks explicitly marked ✅.
- **Placeholder scan:** no TBD/TODO; every code step carries complete code; every command has expected output. The "synthetic vector" language is intentional (real vectors pinned on-device in Task 10), not a placeholder gap.
- **Type consistency:** `PmdAccSample`/`PmdAccFrame`/`decodePmdAccFrame`/`magnitude` (Phase 2) reused unchanged in Phases 4–5; `buildAccStartCommand`/`buildAccStopCommand`/`PMD_SERVICE`/`PMD_CONTROL_POINT`/`PMD_DATA` (Phase 1) reused in Phase 4; `detectCadence`/`countRunSteps`/`CadenceEstimate`/`RUN_CADENCE_*` (Phase 3) reused in Phase 5. `PmdStreamCallbacks.onSamples(samples, timestampNs)` matches the console's `onSamples` usage.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-17-strap-cadence-spike.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Note: Phases 4–6 are device-only and cannot be completed by a sandbox subagent — they need the owner's APK rebuild + a worn H10.

**2. Inline Execution** — execute the sandbox-testable tasks (Phases 1–3, and the typecheck/lint/render checks of 4–5) in-session with checkpoints; hand Phases 6–7 to the owner on-device.

**Which approach?**

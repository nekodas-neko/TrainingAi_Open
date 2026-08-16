import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  MODEL_NAMES,
  verifyConstantsIntegrity,
  getModelConstants,
  modelSha,
  modelVersion,
  getStepsDecoderConstants,
  getDaytimeStressConstants,
  getSleepStagingConstants,
  getOtsConstants,
} from '../index'
import { hasRealConstants } from '../../__fixtures__/real-constants'

const ROOT = path.resolve(__dirname, '../../../..')

// Four of the six blocks below read specific vendored magnitudes and only hold where the
// vendor's files are. The other two — MANIFEST integrity and the registry's shape — hold against
// the synthetic fixtures too, because both are self-consistent by construction rather than pinned
// to a value, and the whole `runtime constants loading` describe is about the mechanism.
const itVendor = it.skipIf(!hasRealConstants())

describe('vendored Oura model constants', () => {
  it('every file matches its MANIFEST sha256 (integrity)', () => {
    expect(verifyConstantsIntegrity()).toEqual([])
  })

  it('every vendored model loads with a source + sha + version', () => {
    // 13 since 2026-08-10: `dhrv_imputation_1_1_0` was registered so `getDhrvScaling()` can read
    // its means/stds, which `lib/health/daytime-stress.ts` had inline. The count is asserted rather
    // than derived so adding a model is a deliberate edit here, not a silent one.
    expect(MODEL_NAMES.length).toBe(13)
    for (const name of MODEL_NAMES) {
      const c = getModelConstants(name)
      expect(c.source, name).toBeDefined()
      expect(modelSha(name), name).toMatch(/^[0-9a-f]{64}$/)
      expect(modelVersion(name), name).toBeTruthy()
    }
  })

  itVendor('steps decoder: stride_frequency dequantization matches the extracted table', () => {
    const d = getStepsDecoderConstants()
    expect(d.n_output_features).toBe(11)
    expect(d.output_columns).toContain('stride_frequency')
    const sf = d.decoder_base_settings['stride_frequency']
    expect(sf.low).toBe(0.68)
    expect(sf.high).toBe(3.4)
    expect(sf.bits).toBe(9)
    expect(sf.encode_zero).toBe(1)
    // stride_frequency is linear (no transform)
    expect(d.decoder_transform_settings['stride_frequency']).toBeUndefined()
  })

  itVendor('daytime stress: remap + activity-gate constants', () => {
    const s = getDaytimeStressConstants()
    expect(s.targetLevelLimit).toBe(0.5)
    expect(s.scaledLevelLimit).toBe(0.4)
    expect(s.ringMetLimit).toBe(1.8)
  })

  itVendor('sleep staging: HRV bands (mHz) + feature-column list', () => {
    const s = getSleepStagingConstants()
    expect(s.useMillihz).toBe(true)
    expect(s.hrvBands.vlf).toEqual([3, 40])
    expect(s.hrvBands.lf).toEqual([40, 150])
    expect(s.hrvBands.hf).toEqual([150, 400])
    // the autonomic-shape features that break the REM plateau must be present
    for (const col of ['hrv_csi_5min', 'hrv_HF_5min', 'hrv_rRR_5min', 'hrv_rMSSD_5min']) {
      expect(s.hrvFeatureColumns, col).toContain(col)
    }
  })

  itVendor('OTS: extracted scalars (correcting earlier skill prose)', () => {
    const a = getOtsConstants()
    // Plain scalars:
    expect(a['met_intensity_gamma']).toBe(1)
    expect(a['met_intensity_M']).toBe(8)
    expect(a['validator.min_mets_count']).toBe(720)
    // Some OTS attributes are tensor-wrapped ({ kind:'tensor', values:[...] }) — consumers unwrap.
    const highThreshold = a['high_ots_threshold'] as { values: number[] }
    expect(highThreshold.values[0]).toBe(4)
  })
})

// ── Runtime loading, added 2026-08-13 when the static imports were removed (Q-49 A3) ───────────
describe('runtime constants loading', () => {
  it('reads from OURA_CONSTANTS_DIR when set, so the files can live outside the repo', async () => {
    // The property the public cut rests on: the directory is a runtime input, not a build-time one.
    // A static import could not be redirected like this at all, which is why it had to go.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'constants-override-'))
    // Source the files from wherever the loader would read them, not from a path fixed relative to
    // this file. In the publish dry-run the tree has no JSONs — they are supplied through
    // OURA_CONSTANTS_DIR, exactly as production will supply them from the bucket — and a hardcoded
    // repo-relative path silently copies nothing and fails on an empty directory.
    const real = process.env.OURA_CONSTANTS_DIR ?? path.join(ROOT, 'lib/oura-models/constants')
    for (const f of fs.readdirSync(real)) {
      if (f.endsWith('.json')) fs.copyFileSync(path.join(real, f), path.join(tmp, f))
    }
    const prev = process.env.OURA_CONSTANTS_DIR
    process.env.OURA_CONSTANTS_DIR = tmp
    vi.resetModules()
    try {
      const mod = await import('../index')
      expect(mod.getResilienceConstants().planeFitCoef.length).toBeGreaterThan(0)
    } finally {
      if (prev === undefined) delete process.env.OURA_CONSTANTS_DIR
      else process.env.OURA_CONSTANTS_DIR = prev
      vi.resetModules()
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('throws rather than returning a partial answer when a constant is missing', async () => {
    // The ONNX loaders are infallible by contract because a missing model has a degraded fallback.
    // A missing constant does not — it would be a wrong number, silently. Different contract.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'constants-empty-'))
    const prev = process.env.OURA_CONSTANTS_DIR
    process.env.OURA_CONSTANTS_DIR = empty
    vi.resetModules()
    try {
      const mod = await import('../index')
      expect(() => mod.getResilienceConstants()).toThrow()
    } finally {
      if (prev === undefined) delete process.env.OURA_CONSTANTS_DIR
      else process.env.OURA_CONSTANTS_DIR = prev
      vi.resetModules()
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })
})

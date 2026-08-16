import { describe, it, expect } from 'vitest'
import { buildBucketReport, type BucketFileStat } from '../bucket-report'
import { REQUIRED_MODEL_FILES } from '../required-models'

const PREFIX = 'oura-model-onnx'

function statsFor(overrides: Record<string, Partial<BucketFileStat>> = {}): BucketFileStat[] {
  return REQUIRED_MODEL_FILES.map(file => ({
    file,
    key: `${PREFIX}/${file}`,
    found: true,
    sizeBytes: 1024,
    error: null,
    ...(overrides[file] ?? {}),
  }))
}

const allKeys = REQUIRED_MODEL_FILES.map(f => `${PREFIX}/${f}`)

describe('buildBucketReport', () => {
  it('calls it complete only when every required file is present and non-empty', () => {
    const r = buildBucketReport(PREFIX, statsFor(), allKeys, null)
    expect(r.verdict).toBe('complete')
    expect(r.missing).toEqual([])
    expect(r.empty).toEqual([])
  })

  it('reports a zero-length file as unusable, not as present', () => {
    const victim = REQUIRED_MODEL_FILES[0]
    const r = buildBucketReport(PREFIX, statsFor({ [victim]: { sizeBytes: 0 } }), allKeys, null)
    expect(r.verdict).toBe('incomplete')
    expect(r.empty).toEqual([victim])
    expect(r.missing).toEqual([])
    // The summary has to say the app is now broken rather than "a fallback is carrying it" — there
    // is no fallback since A4b, and the boot check fails production on exactly this verdict.
    expect(r.summary).toContain('no repo-tree copy')
  })

  it('reports an absent file as missing', () => {
    const victim = REQUIRED_MODEL_FILES[1]
    const stats = statsFor({ [victim]: { found: false, sizeBytes: null } })
    const r = buildBucketReport(PREFIX, stats, allKeys.filter(k => !k.endsWith(victim)), null)
    expect(r.verdict).toBe('incomplete')
    expect(r.missing).toEqual([victim])
  })

  // The failure that cost a session: auth rejection rendered as "all eight files absent", which
  // reads as a failed upload and sends you to re-upload files that were already there.
  it('never reports missing files when the bucket could not be reached', () => {
    const r = buildBucketReport(PREFIX, statsFor({}), [], 'SignatureDoesNotMatch (403)')
    expect(r.verdict).toBe('unreachable')
    expect(r.missing).toEqual([])
    expect(r.empty).toEqual([])
    expect(r.summary).toContain('SignatureDoesNotMatch')
  })

  it('an empty bucket is incomplete, not unreachable — the two must not collapse', () => {
    const stats = statsFor(
      Object.fromEntries(REQUIRED_MODEL_FILES.map(f => [f, { found: false, sizeBytes: null }])),
    )
    const r = buildBucketReport(PREFIX, stats, [], null)
    expect(r.verdict).toBe('incomplete')
    expect(r.missing).toHaveLength(REQUIRED_MODEL_FILES.length)
  })

  it('names keys under the prefix that nothing requires', () => {
    const r = buildBucketReport(PREFIX, statsFor(), [...allKeys, `${PREFIX}/stray.onnx`], null)
    expect(r.verdict).toBe('complete')
    expect(r.unexpected).toEqual([`${PREFIX}/stray.onnx`])
  })
})

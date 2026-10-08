// Issue 2383 (item 5): Sync & Redecode waits for the upload to finish, not a fixed 4 s.
import { describe, it, expect } from 'vitest'
import { waitForUploadToSettle, type UploadStatus } from '@/lib/oura-ble/upload-settle'

function harness(statuses: Array<UploadStatus | 'throw'>) {
  const slept: number[] = []
  let i = 0
  return {
    slept,
    reads: () => i,
    opts: {
      sleep: async (ms: number) => { slept.push(ms) },
      getStatus: async (): Promise<UploadStatus> => {
        const s = statuses[Math.min(i, statuses.length - 1)]
        i++
        if (s === 'throw') throw new Error('plugin gone')
        return s
      },
    },
  }
}

describe('waitForUploadToSettle', () => {
  it('keeps waiting while frames are still being acknowledged, then settles once they stop', async () => {
    // First read is the baseline. Posted keeps climbing for 6 polls (a 6 s upload), then holds.
    const climbing = [0, 255, 510, 765, 1020, 1275, 1530].map(n => ({ draining: false, ingestPosted: n }))
    const h = harness([...climbing, { draining: false, ingestPosted: 1530 }])
    const out = await waitForUploadToSettle(h.opts)
    expect(out).toBe('settled')
    // Longer than the old fixed 4 s, because the upload was still moving.
    expect(h.slept.reduce((a, b) => a + b, 0)).toBeGreaterThan(4_000)
  })

  it('does not call it settled while a drain is still running, even if no frame landed yet', async () => {
    const h = harness([
      { draining: true, ingestPosted: 0 }, { draining: true, ingestPosted: 0 }, { draining: true, ingestPosted: 0 },
      { draining: true, ingestPosted: 0 }, { draining: true, ingestPosted: 0 }, { draining: true, ingestPosted: 0 },
      { draining: false, ingestPosted: 0 },
    ])
    const out = await waitForUploadToSettle(h.opts)
    expect(out).toBe('settled')
    expect(h.reads()).toBeGreaterThan(8)
  })

  it('settles quickly when nothing is uploading', async () => {
    const h = harness([{ draining: false, ingestPosted: 7 }])
    expect(await waitForUploadToSettle(h.opts)).toBe('settled')
    expect(h.slept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(4_000)
  })

  it('gives up at the ceiling when the upload never goes quiet, and says so', async () => {
    let n = 0
    const h = harness([])
    h.opts.getStatus = async () => ({ draining: false, ingestPosted: n++ })
    expect(await waitForUploadToSettle({ ...h.opts, maxMs: 10_000 })).toBe('timeout')
    expect(h.slept.reduce((a, b) => a + b, 0)).toBe(10_000)
  })

  it('falls back to the old fixed wait on an APK that reports no upload counter', async () => {
    const h = harness([{ draining: false }])
    expect(await waitForUploadToSettle(h.opts)).toBe('unsupported')
    expect(h.slept).toEqual([4_000])
  })

  it('treats a failed status read as no news, not as settled', async () => {
    const h = harness([{ ingestPosted: 1 }, 'throw', 'throw', 'throw', 'throw', 'throw', { ingestPosted: 1 }])
    const out = await waitForUploadToSettle(h.opts)
    expect(out).toBe('settled')
    expect(h.reads()).toBeGreaterThan(8)
  })
})

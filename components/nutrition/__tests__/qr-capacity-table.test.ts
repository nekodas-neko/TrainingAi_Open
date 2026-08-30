// BF-57 — the byte-capacity table in `packages/shared` checked against the real QR encoder.
//
// `label-payload.ts` carries a table of byte-mode capacities per version at EC level M, taken from
// the QR spec rather than from the `qrcode` package, because `packages/shared` stays dependency-free
// and the renderer is the only place that should import a QR library.
//
// That leaves two sources for one fact, so this file makes them agree. The division of labour is
// deliberate: **the table decides the payload BUDGET, the library decides the version actually
// drawn.** If they ever disagree the library wins and the code merely comes out bigger — safe rather
// than wrong — but a table that is wrong the OTHER way would let a payload through that needs a
// finer module pitch than the label can print, which is the failure this whole entry is about.
import { describe, it, expect } from 'vitest'
import QRCode from 'qrcode'
import { QR_BYTE_CAPACITY_M, qrVersionForBytes, MEAL_SHARE_MAX_BYTES } from '@trainingai/shared/nutrition/label-payload'

/** What version the real encoder picks for `bytes` bytes of byte-mode data at EC M. */
const actualVersion = (bytes: number) =>
  QRCode.create('x'.repeat(bytes), { errorCorrectionLevel: 'M' }).version

describe('the QR capacity table matches the encoder it is a stand-in for', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])(
    'version %i holds exactly what the table says', (version) => {
      const capacity = QR_BYTE_CAPACITY_M[version]
      // A payload of exactly the stated capacity fits this version…
      expect(actualVersion(capacity), `${capacity} bytes`).toBe(version)
      // …and one byte more does not.
      expect(actualVersion(capacity + 1), `${capacity + 1} bytes`).toBeGreaterThan(version)
    })

  it('agrees with the table on the sizes the entry measured', () => {
    for (const bytes of [69, 167, 265, 412, 510]) {
      expect(actualVersion(bytes), `${bytes} bytes`).toBe(qrVersionForBytes(bytes))
    }
  })

  // The budget is only meaningful if the encoder agrees a payload of that size stays at version 11.
  it('keeps a full-budget payload at version 11', () => {
    expect(actualVersion(MEAL_SHARE_MAX_BYTES)).toBe(11)
  })
})

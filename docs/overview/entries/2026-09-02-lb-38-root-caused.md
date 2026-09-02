# 2026-09-02 — LB-38 root-caused: zxing cannot read certain valid QR symbols upright

**Lane B · branch `fix/lb-38-decode-rotations` · no version bump · test harness only**

LB-38 has been open for days as a rare e2e "flake". It is not a flake and it was never in the app.

## The cause

`@zxing/library`'s detector cannot read certain **valid** QR symbols in their upright orientation.
Measured over **3,000** freshly generated meal tokens, encoded by the same `qrcode` call the label
renderer makes and rendered synthetically at the label's own 13 px per module — **no app code in the
reproduction at all**:

| decode strategy | undecodable |
|---|---|
| upright, `HybridBinarizer` | **115 / 3000 (3.83%)** |
| any of four rotations | **4 / 3000 (0.13%)** |
| + `TRY_HARDER` and `GlobalHistogramBinarizer` | 4 / 3000 (0.13%) — no further help |

**The symbols are valid, and rotation proves it**: seven of eight sampled failures decode once turned,
and rotating changes nothing but the detector's traversal. The rate is independent of error-correction
level (L/M/Q/H all ~4%), QR version (25 and 29 modules alike), mask pattern (spread across all eight),
module size at 3 px and above, and quiet-zone width.

## The arithmetic is the confirmation

Each run seeds one meal, so one token, and every style draws that same symbol — a run fails on all of
them or none. **3.83% is 1 in 26, against the ~1 in 19 this file was measured at.** The "flake" was
deterministic per meal id the whole time, which is also why no retry ever helped.

## What shipped

`e2e/qr-decode.ts` exports `decodeQrRotating`, which tries the four orientations; `meal-label.spec.ts`
imports it in place of its local decoder. That is not a retry and not a workaround for a rendering
fault — it is what a real scanner does anyway, since nobody holds a phone square to a label.

**The residual 0.13% is real and is not claimed as zero.** One token in the sample failed all four
rotations under every binarizer, and it is in the test as a fixed case.

## The fix needed a guard the spec cannot give it

A good token decodes upright, so the rotation loop never runs and a green spec proves nothing about
it — and the spec cannot choose its meal's id. So `lib/__tests__/qr-decode-rotations.test.ts` pins a
**fixed token measured to fail upright**, which exercises the path on demand.

**Four mutations kill it**: the loop running once, the rotation being a no-op, dropping the
width/height swap, and throwing instead of returning null. The third one **survived the first
version** — every case was square, and square is exactly where the swap is a no-op. A non-square case
closes it.

The test deliberately does **not** assert that the upright read fails. That is true today and is the
whole reason the file exists, but pinning it would turn an upstream zxing fix into a red suite.

## Every earlier theory on this entry was wrong

The ink floor, a degenerate `getImageData`, decoder *configuration*, in-run decode invocation, low ink
as a signature, a torn canvas, and the render race published in #806 and refuted in #807. Three of
those were mine, published on the same day.

**The one thing never checked was the encoder/decoder pair in isolation** — and it took minutes once
tried, needed no failing run, and gave a rate that matched the observed one to within a rounding
error. Days of expensive 1-in-19 captures went into a question a 2,000-iteration loop answered
immediately. The lesson is not "measure more"; it is **reproduce the failure away from the system you
suspect** before instrumenting the system you suspect.

## Product note, flagged rather than claimed

The app's own scanner is `@zxing/browser`, the same core. So ~4% of meal labels may be unreadable
**upright** by the app that printed them. Two things make that less alarming and neither is a proof: a
real scan is a camera image at arbitrary rotation, and the continuous scanner tries many frames — and
rotation clears all but 0.13%. **Not measured on a real camera**, so this is a flag for the owner, and
it sits on the entry as a `Keep:` rather than as work.

**Not exercised:** the device, and a real camera scan. Nothing in this diff is app code — the label
renderer, the scanner and every component are untouched. `pnpm check:rules` **Ran 67 of 67**; full unit
suite **6,339 tests**; `e2e/meal-label.spec.ts` green.

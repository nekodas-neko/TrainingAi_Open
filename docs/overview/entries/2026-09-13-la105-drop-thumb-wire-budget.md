# 2026-09-13 — the capture workaround dies with the cap that caused it (LA-105)

**Branch:** `chore/la105-drop-thumb-wire-budget` · **Agent:** Implementation Lane B

## The whole life of a workaround, in one day

Shipping OR-108 this morning, the camera path 413'd the first time it ran end to end:
`/api/nutrition/food-items` capped its whole body at **8 KB** while permitting a **16 KB** image, and
base64 costs a third more than the bytes it carries. A 128 px WebP of a detailed source is 6,612
bytes — **8,816 characters** — so the request was refused *before* `rejectMealImage` ever ran. The
user lost the food, not the picture.

That route is Lane A's, so it was filed as **LB-101** and worked around in the client: a
`THUMB_WIRE_BUDGET = 7 * 1024`, a quality ladder walking 0.8 → 0.6 → 0.45 to fit it, and a
`tooBigForTheBody` guard that dropped the image rather than send a body that would fail. Both the
entry and the code said the same thing — this exists only because of LB-101, delete it when the cap
moves.

**LB-101 shipped hours later.** `MAX_BODY_BYTES` is now
`Math.ceil(FOOD_ITEM_IMAGE_MAX_BYTES * 4 / 3) + 4 * 1024` — **25,942 bytes**, derived rather than
restated, so the two cannot drift again. Lane A filed LA-105 to collect the debt.

## What was removed

- `THUMB_WIRE_BUDGET` and the `tooBigForTheBody` guard in `capture-actions.tsx`.
- The quality ladder and the `maxEncodedChars` parameter in `downscaleToThumbDataUrl` — no caller
  passed it once the guard went, and a three-rung re-encode nothing exercises is dead weight.
  **The downscale itself stays**: shrinking a capture before upload is right regardless of what the
  route accepts, which is what LA-105 warns against removing.
- The two source assertions pinning them, replaced by one asserting their **absence** — a workaround
  that outlives its cause reads as deliberate to the next person.

## Verified by measurement, which is what the entry asked for

`e2e/food-photo-saves-image.spec.ts` stores the same fixture and reads it back out of Postgres. Its
wire assertion is **inverted rather than deleted**: it now requires the stored image to be *larger*
than the old 7 KB budget, so it fails if the ladder ever returns. The saved thumbnail is 8,816
characters — the exact size that 413'd this morning, now stored at its natural quality.

- Custom Rules **74 of 74**, `tsc` clean, eslint clean, `pnpm test` clean, `pnpm build` clean.

## Not verified

- **Not on the device.** The web `<input>` feeds the same handler and the same canvas re-encode, but
  the Capacitor camera's own capture is not exercised here. OR-108's device check still stands.

# 2026-09-14 — Cardio Baselines moves to the Cardio tab (BF-159)

**Branch:** `fix/cardio-baselines-to-cardio-tab` · **Lane B** · v1.456.1

## What it was

Owner, immediately after having to be told where the Cooper test lives: *"That section should be
moved to cardio hub."*

`LatestBaselineCard` sat in the Health tab's `TRAINING_ORDER`, between *Muscle Volume This Week* and
*Workout Density*. Every card around it is about lifting; this one holds VO₂max and heart-rate
recovery.

The placement mattered more than a misfiled card usually would, because **`/baselines` has exactly
one entrance in the whole app** — `grep -rn "/baselines"` returns only this card. So a card in the
wrong list was the entire discoverability story for all three protocols: the 6-minute walk, Cooper,
and resting HR + recovery.

## What shipped

- `LatestBaselineCard` renders in `cardio-content.tsx`, **under `HeartProfileCard`, above
  `ModalityPicker`**. The heart profile is what the heart is doing lately; the baseline is what it
  was measured at, so the two read as a pair — and putting it above the picker means it is seen
  while deciding what to do today, which is when taking a test is a live option.
- `CardioContent` takes `userId`, threaded from `app/cardio/page.tsx`'s session. Without it the card
  falls through to `cachedFetch` instead of `getLocalStore`, which would have quietly downgraded a
  local-first read to a server-only one on the device.
- **Moved, not duplicated.** The `TRAINING_ORDER` entry and the `baselineTests` case in
  `health-sections.tsx` are both gone in the same commit.

## Verification

`e2e/cardio-baselines-placement.spec.ts` asserts the card is on Cardio, that its `/baselines` link
came with it, and that Health no longer renders it — the last one guarded against a Training panel
that actually rendered, so an empty screen cannot pass it.

**Both halves were proven to fail without the change**, which is the part worth recording:

| Half | How it was falsified |
|---|---|
| present on Cardio | ran against clean `main` (source changes stashed) — failed |
| absent from Health | ran against a build with the card deliberately in *both* places — failed |

The second run is the one that mattered. The first assertion fails first, so a single negative run
never exercises the Health half at all — it would have shipped unproven, guarding precisely the
two-entrances failure the entry warns about.

## What was NOT exercised

- **No device.** Playwright at 412 dp on `pnpm dev`. The entry's own verification asks for the S25:
  the card on the Cardio tab, gone from Health, and its link still working from the new position.
- **No local store.** `getLocalStore` returns null in the sandbox, so the card was only ever seen
  taking its `cachedFetch` fallback. The `userId` prop threaded here is exactly the path that only
  runs on the APK.
- **No populated baselines.** The local database has no fitness tests, so the card rendered its
  "Take a fitness test to set your baseline" state throughout. The populated layout — up to three
  protocols wrapping in a flex row — is unseen at 412 dp in its new column.

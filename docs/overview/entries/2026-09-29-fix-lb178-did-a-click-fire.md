# 2026-09-29 — LB-178: the diagnostic answered, and it retired my own plan

**Lane B.** Branch `fix/lb178-did-a-click-fire`. Test-only — no product code, no version bump.

## The reading

`#1964` shipped a diagnostic that names whatever sits under `food-log-swipe-delete:238`'s tap point.
Its own run was the first to carry it, and shard 2 obliged by failing.

**On CI the topmost element is `button… "Delete"`** — on the first attempt and on the retry.

So the coordinate is right and the press is swallowed. That kills **both** candidates this entry had
been carrying: not the geometry, and not the Chromium build (CI's `chromium_headless_shell` against
the sandbox's pre-installed one), which I had called *"the candidate that fits"* this morning and then
already downgraded once to one of two. It is neither.

## It also retired the plan I wrote for this exact outcome

`#1964` said: *if the topmost element is the Delete control … the sibling at `:274` is then the shape
`:238` should adopt.*

That is wrong, and the answer is what shows it. `:274` asserts **the tray is the topmost element over
its own rect** — which is precisely what this diagnostic has now proved true on CI. Converting `:238`
to that shape would swap a failing assertion for one already known to pass. That is quarantining the
failure under a different name, which this repo forbids for good reason.

Worth stating plainly: the plan was written before the answer existed, and reading the answer is what
made it visible. A decision rule written in advance is still a guess until its input arrives.

## What is still open, and the one fact that settles it

The button's handler has no guard to blame — `swipe-actions.tsx` runs
`openRows.delete(close); close(); a.onPress()` unconditionally. So either the app never receives the
click, or it receives it and the confirmation still does not open. One fact separates those:

- **click fires, no confirmation** → the app ignores a press this soon after a drag. A real defect, and
  the same shape `BF-61` was filed for after the device failed it twice.
- **no click at all** → the browser never synthesised one from a CDP tap issued this soon after a CDP
  swipe. That is the harness's limit rather than the product's — and the spec's own docstring already
  says the device-level cause is unreachable from here.

The spec now installs capture-phase listeners for `pointerdown`, `touchstart`, `touchend` and `click`
on `document` before tapping, and appends what they saw to the same failure message (`events seen: …`).
Capture phase on `document` means nothing the button does can hide them.

## Verified

- `e2e/food-log-swipe-delete.spec.ts` — **8 of 8 locally** with both diagnostics in, `:238` among them.
  The assertion still requires the confirmation to open.
- `npx tsc --noEmit`, `npx eslint` on the spec, `pnpm check:rules` **Ran 83 of 83**, `pnpm test`,
  `pnpm build`.

## Not exercised

- **The failing environment**, again. This ran on the sandbox's Chromium, where the spec passes; the
  listeners exist to report from the machine where it does not, and this PR's own shard-2 run is their
  first real exercise. That is the second consecutive PR whose verification is owed to its own CI run,
  which is the cost of debugging a fault that only exists on a machine this container cannot be.

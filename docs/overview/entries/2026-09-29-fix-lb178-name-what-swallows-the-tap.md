# 2026-09-29 — LB-178: make the one remaining red spec say why it failed

**Lane B.** Branch `fix/lb178-name-what-swallows-the-tap`. Test-only — no product code, no version bump.

## Where the entry actually stood

`LB-178` was filed as *"the suite is flaky once specs share a run, and nobody knows how flaky"*. The
census part is done — five CI runs plus local repeats — and it left **one** spec red:
`food-log-swipe-delete:238`, which by today's runs is **6 of 6 failing on CI and 0 of 8 failing
locally**.

That ratio is the finding. A shared-state or ordering fault is *mixed*; this is deterministic on each
machine and opposite between them, so it is systematic. It also survived the change that was supposed
to fix its class: `LB-166` gave every shard its own Postgres, which was this entry's leading suspect
for `:238`, and the spec failed anyway.

## A correction to my own note from this morning

Earlier today I recorded the browser build as *"the candidate that fits"* — CI installs
`chromium_headless_shell` while a sandbox session runs the pre-installed Chromium, and the spec turns
on a CDP tap landing inside a 64 px tray.

That is **one** of two candidates, not the one. Reading the spec again: it taps a coordinate derived
from a `stableBox` captured **before** the swipe, and taps immediately after the release. A systematic
difference in the resting geometry *or* in how far the row has settled by tap time produces exactly
this split. Nothing measured so far separates *the coordinate missed the tray* from *the tray swallowed
the press*, and I should not have named one of them as the fit.

## What ships instead of a guess

The spec now reads `document.elementFromPoint` at its own tap coordinate, immediately before tapping,
and interpolates the result into the assertion's failure message:

> `the press right after the release was swallowed… At (344, 268) the topmost element was
> button.…"Delete"`

The retained artifact could only ever show that the confirmation was absent. This says what was under
the finger, which is the fact that separates the two candidates — and it needs no headless-shell, which
this container cannot install.

**Verified inert on the happy path:** the file passes **8 of 8** locally with the diagnostic in,
`:238` among them, so nothing about the assertion or its timing changed.

## What is owed, and it is a read rather than a build

Read the message off the next shard-2 failure.

- If the topmost element is the Delete control, the coordinate is right and the press is genuinely
  being swallowed on the web path — a real defect, and the sibling at `:274` (which asserts the same
  property coordinate-free and passes on CI) is the shape `:238` should take.
- If it is the row or anything else, the coordinate is wrong against CI's geometry, and the fix is to
  derive the tap point *after* the release rather than before it.

## Not exercised

- **The failing environment.** Everything here was run on the sandbox's Chromium, where the spec
  passes; the diagnostic's whole purpose is to report from the machine where it does not, and it has
  not yet run there.
- **The device.** A test-harness change; no product code and nothing the APK runs.

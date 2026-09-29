# 2026-09-29 — LB-178: the six-run red was Chromium's tap suppression, and the test measuring it is gone

**Lane B.** Branch `fix/lb178-assert-the-half-the-app-owns`. Test-only — no product code, no version bump.

## The answer

`#1965`'s listeners reported from the machine that fails:

> `events seen: pointerdown:Delete | touchstart:Delete | touchend:Delete`

All three on the Delete button. **No `click`, on either attempt.** So the touch reaches the right
element and Chromium never synthesises a click from it — its **tap-suppression window after a gesture**,
entered because the tap is a CDP dispatch issued immediately after a CDP swipe.

The control that makes this an explanation rather than a story: the sibling at `:192` taps identically
just *outside* that window, gets its click, and has been green the whole time.

That closes a chain of three readings, each of which killed a candidate I had written down:

| reading | killed |
|---|---|
| a database per shard did not fix it | shared seed state, this entry's leading suspect |
| `elementFromPoint` → `button "Delete"` | the coordinate, and the Chromium **build** |
| `pointerdown/touchstart/touchend`, no `click` | the app — it never gets a press to ignore |

## So the test is removed, and the removal was checked rather than argued

Its unique content was Chromium's behaviour. Every app-side claim it made is held by a named sibling,
verified before removing it and recorded in the spec file where it stood:

- tray raised while the row is displaced → **the tray is hit-testable the moment the row moves**, which
  holds the row mid-drag at 36 px — where the old `isOpen` gating measurably fails;
- press opens a confirmation rather than deleting → **a swipe reveals Delete, and Delete asks before it
  deletes**;
- the same, mid-animation → **the first tap on Delete opens the confirmation, even mid-animation**.

What is genuinely lost is the device half — the press the S25 swallows — and that was never reachable
here. The spec's own docstring said so, and sweep 4a's probing at 0/100/300/500 ms could not reproduce
it on the web path either.

## ⚠ The part worth keeping: I wrote a replacement, and it was wrong while green

Before removing it I narrowed the test to assert the hit test **at the instant of release** and ran it:
**8 of 8 green.** Then I checked what it would actually catch, and it catches nothing — **at rest
`isOpen` and `displaced` are both true**, so it passes under the exact `isOpen` regression it claimed to
guard. `:274` catches that because it holds the row *mid-drag*; at rest there is nothing to separate.

A green test that cannot fail for its stated reason is worse than no test, and it took writing the thing
out to see that rather than reasoning about it. That is the second time today a decision rule I wrote in
advance did not survive its own input.

## Verified

- `e2e/food-log-swipe-delete.spec.ts` — **7 of 7 locally** after the removal.
- Before it: **8 of 8** with the rejected replacement, which is how its emptiness was found.
- `npx tsc --noEmit`, `npx eslint` on the spec, `pnpm check:rules` **Ran 83 of 83**, `pnpm test`,
  `pnpm build`.

## Not exercised

- **Shard 2 going green.** That is the prediction this PR makes and its own CI run is the first test of
  it — the third consecutive PR here whose verification is owed to its own run, which is the standing
  cost of a fault that only exists on a machine this container cannot be.
- **The device.** Test-harness only; no product code and nothing the APK runs.

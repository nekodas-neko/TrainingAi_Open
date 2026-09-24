# RV-144 — four profile inputs under the touch floor, and the gate that could not see them

**Branch:** `fix/rv144-touch-floor-profile-inputs` · **Entries:** RV-144 (shipped), LB-140 (re-laned) · **Version:** unchanged

## The defect

Three inputs on `/more/details` — display name, birth year, height — rendered at **346 × 23** at the
mobile-chromium viewport. Review measured 318 × 21 on the S25 and, on a second pass, ~33 px of real
vertical touch area against the repo's 44 px floor. The cause is one class string shared by all of
them: `border-0 bg-transparent p-0 h-auto` collapses the `Input` primitive's `h-9` to a bare text
line, so the row looks right and the control is a third of the size it reads as.

They now carry `min-h-[48px]`, which is the only change to how they render.

**48, not the 44 the entry asked for.** `globals.css`'s own floor for `button`/`[role=button]` is 48
and `e2e/touch-target-size.spec.ts` asserts 48. Shipping 44 would have satisfied the entry and still
failed the repo's own gate the moment that route was covered by it — which is the next paragraph.

**A fourth input, from the sibling sweep the entry asked for.** The same class string is on the
weight-goal input in `components/profile/edit-profile-sheet.tsx`. Fixed here too.
`goal-targets-section.tsx` only *mentions* the pattern in a comment — LB-63 removed it there.

## Why nothing caught it

`touch-target-size.spec.ts` measured five paths: `/`, `/health`, `/workout`, `/nutrition`, `/more`.
All five are tab roots. **`/more/details` is a pushed route, so no automated check has ever looked at
it**, and the three inputs sat undersized for as long as that list has existed. Adding the route is
the durable half of this change; the `min-h` is the part that stops being needed if someone rewrites
the screen.

Measured both ways: with the route added and the fix in, **8 of 8 pass**. With the route added and
the two component files stashed out, `/more/details` fails naming exactly `input 346×23` three
times. So the assertion discriminates, and it independently reproduces Review's finding at a
different viewport.

Nothing else on that route is below the floor.

## LB-140 — re-laned to DV, and why the probe is not worth retrying

LB-140 (the step-by-step meal-plan setup sheet that never opens) was filed with "reproduce on a real
build" as its first action. That was attempted here and **cannot be done in a container**:

- The first failure, `routesManifest.dataRoutes is not iterable`, was a corrupted `.next` left by
  deleting `.next/types` during LB-139. A clean `pnpm build` fixes it, and the manifest's
  `dataRoutes` is `[]` — iterable.
- The real blocker is deliberate. `next start` sets `NODE_ENV=production`, and
  `instrumentation-node.ts`'s `fatalOrLoud` **throws on boot** when the model constants cannot be
  fetched: *"could not list the bucket: SignatureDoesNotMatch (403)"*. The gate is keyed on
  `NODE_ENV` rather than on whether credentials exist, precisely so a real deploy that lost its
  storage variables fails loudly — and the file states outright that no session sandbox can
  authenticate to that bucket.

So the remaining question — does this reproduce outside the dev server — can only be answered on the
phone, with an objective pass/fail nobody has run. That is the lane rule's definition of DV work, so
the entry moved there with the blocker written into it. It returns to Lane B if it reproduces and
closes if it does not, because then the finding is a dev-server artefact. The letter stays `LB-`:
the letter records who found it.

## Verification

- `pnpm check:rules`: **Ran 77 of 77**, all passed — including *"Controls have accessible names"* and
  the safe-area rules that sit next to this class of change.
- `touch-target-size.spec.ts`: 8 of 8 with the fix; `/more/details` red without it.
- `tsc --noEmit` clean, lint clean on both component files.

**Not exercised:** the S25 itself. This is a CSS-only change delivered through the WebView, and the
spec measures the same box a finger lands on, but the device gate is Review's 44 px measurement on
real hardware and that has not been re-run. Samsung WebView rendering, safe-area insets and drifted
production data were not tested. A production build could not be started here, for the reason above.

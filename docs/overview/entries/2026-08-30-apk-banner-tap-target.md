# Home's APK banner link was a 33 px tap target (LB-26)

**Branch:** `fix/apk-banner-link-height` · **Lane B**

The finding `e2e/touch-target-size.spec.ts` produced on the morning it shipped, closed the same day.

## The defect

Home's *Download Android App* banner rendered its body link at **258×33**, against this repo's 48 dp
floor. It is an `<a>`, and `globals.css`'s floor is `button, [role="button"]` — `<a>` is excluded on
purpose, because a 48 px minimum on an inline prose link would wreck paragraph layout wherever one
appears mid-sentence. So nothing raised it, and until that spec existed nothing measured it either.

It was the only one. Across all five tabs every other undersized control is a `button` carrying a
documented compensating hit box (`tap-target-dot` on the 7×7 carousel dots, `tap-target-44` on More's
photo control).

## The fix, and the one it is not

`min-h-[48px]` on that `<a>`, with `justify-center` because two short lines would otherwise sit at
the top of their own tap target. **Not** widening the CSS floor to `a`, which would reach every prose
link in the app to raise the handful that are actually controls.

That reasoning moved into `globals.css`, beside the floor rule itself — the previous version of this
note lived in the banner's JSX, which is not where someone tempted to widen the selector will be
looking. It also kept the change to **net zero lines** in `session-select-content.tsx`, a baselined
hotspot on a shrink-only ratchet.

**The spec's allowlist is now empty**, and that was part of the fix rather than bookkeeping: an
allowlist that never empties is a backlog wearing a test's clothes. Removing the row is what makes
the spec fail again if the floor is ever lost.

## Proved both ways

With the fix: 7 passed. With `min-h-[48px]` removed and everything else unchanged, the spec fails
with exactly the reported measurement — `a 258×33 "Download Android AppGet the latest APK"`. So the
guard is anchored to this defect and not to the page merely rendering.

`pnpm check:rules` — Ran 62 of 62. Typecheck clean. (One lint warning in that file, an unused `idx`
at the `HomeCardWidget` call, is pre-existing on `main` — verified by stashing.)

## A rule that failed to fire, and where it now lives

**LB-26 was filed with `Gate: device` on an entry that had never been built** — by the session that,
hours earlier, had read BF-45's warning block about exactly that mistake and corrected four entries
for it. A gate *parks* an entry, so it hid this one from `next-item.js`, which is where an
implementer starts. A device requirement on unbuilt work belongs in **Verification**, not in `Gate:`.

The warning existed; it was buried inside the entry that found it, where nobody *writing* a new entry
would see it. It is now in the backlog's protocol header, next to the `Gate:` definition. That is the
whole correction: the knowledge was not missing, it was in the wrong place.

## Not exercised

**Not seen on the S25.** The web harness measures the box; it cannot say how the banner reads under a
thumb, and the link now claims 15 px more height inside a banner whose dismiss button sits beside it.
That is the check this entry always owed — and it is a Verification requirement, not a gate.

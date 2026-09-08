# 2026-09-08 — the eighteen unnamed icon buttons, and an empty baseline (LA-62)

**Branch:** `fix/la-62-icon-button-names` · **Lane B** · no visual change.

## What it was

An icon-only control with no accessible name is announced by a screen reader as "button", with
nothing to say what it does. Q-162 found six in 2026-08 and wrote a rule to stop the class
recurring; PS-34 found the rule's opening-tag regex stopped at the `>` of `=>`, so every button with
an inline-arrow handler — most of them — was skipped silently. Widening it surfaced eighteen.

## What shipped

All eighteen named, and **the baseline is now empty**. With nothing listed, a file absent from it
must have zero, so every icon-only control in the app needs a name; the check also fails on a
stale-**high** number, which is what stops a cleared file leaving slack for the next one to grow into.

The labels name the action in context rather than the icon, and most take the row's own subject:
`Edit ${program.name}`, `Delete ${style.name}`, `Remove ${ex.name}`, `Accept ${displayName}`. Three
are fixed strings where there is no subject — `Go back`, `Remove screenshot`, `Hide added weight`.
No design decisions: `Pencil`, `Trash2`, `X`, `Check`, `ArrowLeft`, `UserMinus`, `ChevronUpIcon`.

## One thing worth recording

Two of the labels pushed `components/config-screen.tsx` from 997 to 999 lines and tripped the
component-size ratchet, whose message says *extract, do not append*. Extracting a component in an
accessibility PR would be the wrong change; putting the two attributes on the lines their `onClick`
already occupies is the right one, and the file is back at 997. The ratchet exists to stop the file
growing, and it did not grow — but it is worth noting that a two-attribute change reached a rule
about architecture, because the next person hitting it may be tempted to raise the number instead.

## Verified

- `node scripts/check-icon-button-names.js` — **0 baselined, none new**, against an empty baseline
- `pnpm test` — **798 files, 6,874 passed** · `pnpm build` clean · `pnpm lint` 0 errors ·
  `check-test-typecheck` at baseline · `pnpm check:rules` **Ran 70 of 70**
- `npx playwright test touch-target-size` — 7 passed

## Not verified

**TalkBack itself.** The guard proves each control has a name; it cannot prove the name reads well
aloud, and no screen reader has been run over these screens. That check needs the device and is what
Q-491's sibling entries have also been waiting on. Not device-verified; no APK needed.

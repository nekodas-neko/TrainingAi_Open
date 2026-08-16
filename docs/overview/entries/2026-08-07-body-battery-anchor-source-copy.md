# 2026-08-07 — Body Battery's "How it moves" panel stops contradicting the card above it

**Domain:** readiness — v1.267.17, JS-only (no APK rebuild)

## The report

Q-103 (owner UI-bug batch): the expanded Body Battery card showed "Currently 91, from last
night's sleep" directly above a "How it moves" panel unconditionally reading "Opens each morning
at your Readiness" — a visible contradiction on the same card.

## Root cause

`body-battery-card.tsx`'s "How it moves" panel had a hardcoded `"Opens each morning at your
Readiness"` string that never read `battery.anchorSource`. Two sibling lines on the exact same
card already rendered it dynamically — `"Started at ... from readiness"` / `"...from sleep"` in
the has-data branch, and `"Currently ... from this morning's readiness"` / `"...from last night's
sleep"` in the no-data branch. The sleep-anchored state itself is correct, intentional,
already-documented behavior (`resolveAnchor()`'s provisional anchor before Readiness lands for the
day) — only this third line's copy was wrong.

## The fix

```diff
-                  <span>Opens each morning at your <span className="font-medium text-foreground">Readiness</span></span>
+                  <span>
+                    Opens each morning at your{" "}
+                    <span className="font-medium text-foreground">
+                      {battery.anchorSource === "sleep" ? "Sleep" : "Readiness"}
+                    </span>
+                  </span>
```

Matches the existing wording pattern at the other two sites rather than inventing a new format.
`anchorSource` is always available at this point in the render regardless of which branch
(has-data / no-data) rendered above it, since the "How it moves" panel sits outside both.

## Verification

`tsc --noEmit -p .` and `eslint` clean on the touched file. Full suite: 404 files / 3192 tests
green (this component has no dedicated test file — a two-line JSX conditional with no branching
logic beyond the ternary itself).

Verified against `pnpm dev` for the common (readiness-anchored) case: confirmed no regression —
the line still reads "Opens each morning at your Readiness", consistent with "Currently 59, from
this morning's readiness" directly above it, in both light and dark themes (screenshotted).

**Not exercised: the sleep-anchored case itself.** Forcing `anchorSource === 'sleep'` requires
today's derived readiness to be absent while a sleep score exists — but the local seed's
`todaySnapshot` (a persisted anchor row) had already frozen today at `'readiness'` before this
check ran, and `resolveAnchor()`'s first branch (`persisted?.anchorSource === 'readiness'`) locks
that in regardless of what the underlying readiness/sleep rows say afterward. Reproducing the
sleep-anchored state would have meant deleting or backdating that persisted snapshot plus today's
derived-readiness row, a disproportionate amount of local-seed surgery for a 3-line, purely
cosmetic conditional that mirrors a pattern already proven correct at two other sites on the same
card. Verified by code review instead: the new line uses the identical `battery.anchorSource ===
"sleep"` check the sibling lines already use successfully.

No on-device S25 verification — pure copy fix, no native/safe-area/gesture involvement.

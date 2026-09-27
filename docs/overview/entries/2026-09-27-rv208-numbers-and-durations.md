# One duration form, and the bug the second copy was hiding

Implementation Lane B, 2026-09-27. `RV-208`, part one.

## What shipped

**Thousands separators** at the three sites the device sweep confirmed: Home's metric tile
(`11900` → `11,900`, value and `aria-label`), Home's nutrition card (`0 / 1534 kcal`), and More's
profile, which printed `2815 XP total` one line above its own `2,815 XP`. Each now matches the
`toLocaleString()` its neighbours already used.

**One duration form**, routed through `packages/shared/src/format/units.ts` — the module RV-90
created after the same sleep total read differently on adjacent cards.

## The sweep found a defect, not just an inconsistency

`home-day-timeline` had a private `fmt(h)` that floored to the hour and rounded the remainder into
a `mins` it then discarded when the hour was zero. **A 45-minute nap rendered `0h`.**
`formatHoursMinutes` returns `45m`.

That is the case for consolidating rather than writing a style note: a second implementation of a
formatter is somewhere for a bug to live alone, unnoticed, because nothing else renders that
quantity the same way.

Seven copies in all — `walk-summary` and `weekly-stats-hub` (`55m` where every other surface says
`55 min`), `health-metric-sheet`'s `fmtHours` and its two latency renders, and the timeline's
`fmt`. Two of them took **hours** while the shared formatter takes **minutes**, which is plainly
why they were written instead of imported.

**A consequence worth expecting:** an exact hour now reads `7h 00m` rather than `7h` on the sleep
sheet and the day timeline. The padded minute is `formatHoursMinutes`'s deliberate choice, for the
`tabular-nums` columns these sit in.

## The guard, and what it deliberately does not match

`components/ui/__tests__/rv208-one-duration-form.test.ts` matches an interpolated name that *says*
minutes — `${durationMin}m`, `${onsetMin}m` — rather than a bare `${v}m`. The elevation and pace
chart axes are full of those and they are **metres**; a guard that failed them is one people delete
rather than obey.

One exemption, named with its reason: `formatSyncAge`'s `3m ago`. Relative age is a different
idiom from a duration, and "3 min ago" reads wrong. Consolidating it would be the sweep
overreaching.

## What is still open, and two of them are not Lane B's

- **Time-of-day casing is Lane A.** `formatTimeOfDay` emits `6:40am`; the uppercase `6:40 AM`
  comes from `app/api/day-timeline/route.ts:44`, which formats `h:mm a` server-side. One format
  string — and the route returning a display string at all is worth a look while it is open.
- **Unit spacing needs a `formatKg` that emits decimals as needed.** Its default is one decimal,
  so routing the lift sites through it turns `68kg` into `68.0 kg`, which is worse than what it
  replaces. `packages/shared/**` is Lane A's.
- **The movement-category palette needs two new hues.** `SESSION_PALETTE` is indexed by *position*
  (amber, green, indigo, blue, purple, red), so "Push orange, Pull green, Legs purple" is the
  owner's session order rather than a name map — and Movement Balance's `--accent-purple` and
  `--accent-green` collide with slots 2 and 5. Only four accent tokens exist, so a non-clashing set
  means adding two to `globals.css` with contrast checked there. Lane B, but design work, and it
  deserves its own pass rather than a tail-end of this one.
- **Dates and brand-in-food-name** are copy decisions and are untouched.

## A question this raised and did not answer

Every separator site uses a bare `toLocaleString()`, which follows the **device** locale — a phone
set to German renders `1.534`. The fix matches the convention already in the tree rather than
inventing a rival one. Whether counts should pin a locale, as clock times had to, is a
`packages/shared` call and therefore Lane A's.

## Failure surfaces not exercised

The S25. Two daily screens change what they print — the day timeline and the sleep sheet — and a
sandbox render is not the owner looking at them.

## Verification run here

`pnpm lint` 0 errors / 827 warnings (unchanged against the base) · `pnpm check:rules` Ran 80 of 80 ·
`pnpm test` · `pnpm build` · `tsc --noEmit` · `check-test-typecheck` none above baseline · doc-size,
backlog-pointers and doc-links green. Control run: reinstating the timeline's own helper fails the
guard.

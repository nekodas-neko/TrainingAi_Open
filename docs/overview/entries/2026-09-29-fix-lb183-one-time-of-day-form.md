# 2026-09-29 — LB-183: the last two time-of-day forms fold into the shared one

**Lane B.** Branch `fix/lb183-one-time-of-day-form`. UI only — no migration, no API change, no APK.

## What was left

`RV-208` ① found the app writing a clock time four different ways. Lane A shipped the engine half
earlier today: `formatMinutesOfDay(minutes)` in `packages/shared/src/date-utils.ts`, printing exactly
what `formatTimeOfDay` prints for a minutes-since-midnight value, with `formatTime12h` delegating to
it. Verified on `main` before touching anything.

This is the surface half — the two remaining local copies:

- `sleep-verdict-copy.ts`'s `formatClock`, which printed **`11:10pm`** (no space);
- `sleep-timing-trend-utils.ts`'s `clockLabel`, which printed **`11:30 PM`** (uppercase).

Both are now one line calling the helper. Neither is routed through `formatTimeOfDay`, which the
entry warned against and which would have been wrong: that one takes an *instant* and these values are
already-zoned wall-clock minutes, so handing it a `Date` rebuilt from them is the timezone bug this
app keeps re-finding.

## The latent bug the swap fixes, now pinned

`clockLabel` floored the hour and then rounded **the minute alone**: `Math.round(m % 60)`. At 419.6
that is hour 6 and minute `round(59.6)` = 60 — **`6:60 AM`**. The helper rounds the whole value first,
so the carry reaches the hour and it reads `7:00 am`. A test asserts exactly that case, because the
entry named it and a fix nobody tests is a fix that comes back.

## Verified

- `components/health/__tests__/sleep-timing-trend-utils.test.ts` +
  `components/health/sleep/__tests__/sleep-verdict-copy.test.ts` — **25 passed**. Seven expectations
  changed, all of them the rendered form the entry predicted (`11:10pm` → `11:10 pm`, `6:30 AM` →
  `6:30 am`), plus the new `6:60` case.
- **Sibling sweep, and it came back clean:** grepping every `.ts`/`.tsx` under `e2e/`, `components/`,
  `app/`, `lib/` and `packages/` for a rendered `h:mm AM`/`h:mmam` string found **no live assertion**
  on the old forms — only prose. So no e2e spec was pinned to the uppercase label.
- Full gate: `npx tsc --noEmit`, `pnpm check:rules`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Found and deliberately left for Lane A

`app/api/day-timeline/route.ts:18,28` documents its own field as *"formatTimeOfDay: `6:40am`"* and
*"`12:27pm`"*. `formatTimeOfDay` formats with `'h:mm aaa'` — **it has a space**, so those two comments
describe an output form that no longer exists, and line 43 of the same file already tells the story of
the space being added. They are comments, not behaviour, and `app/api/**` is Lane A's under the path
rule, so reaching across to correct them is exactly what the lane split exists to prevent. Recorded
here instead of silently edited.

## Not exercised

- **The device.** Text rendering on two sleep surfaces; no native plugin, safe-area, gesture or
  offline-first path is involved.
- **The screens themselves.** These are pure string functions with direct unit coverage, and the
  change is the format of what they return; nothing was rendered in a browser for this.

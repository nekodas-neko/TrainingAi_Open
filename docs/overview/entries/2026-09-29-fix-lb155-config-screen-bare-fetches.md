# LB-155 — three of the ten were a cache bug; six were never blocked on LB-156 at all

**Branch:** `fix/lb155-config-screen-bare-fetches` · **Version:** 1.482.2

LB-155 carried `Needs: LB-156` and read as "10 conversions, blocked on Lane A registering five cache
keys". LB-156 shipped on 2026-09-28. The keys are registered — verified in `cache-groups.ts` rather
than taken from the entry.

**Reading the ten sites is what showed that the group entries were necessary and nowhere near
sufficient.**

## What the ten actually are

| | sites | verdict |
|---|---|---|
| `config-screen.tsx` phase-set re-open + 2 × `workout-templates` post-write refetch | 3 | **converted** |
| `config-screen.tsx` `openPhaseSetEditor` | 1 | **authoritative** — a conversion would break it |
| `day-checkin` ×3, `plan-meal-answers` ×1 | 4 | local-store **fallbacks**, web-only path |
| `bedtime-estimate` ×2 | 2 | notification **schedulers** |

**Six of the ten will never convert as written**, and none of the six was waiting on a cache group.

## The three that converted were a live bug, not lint debt

`config-screen.tsx` **already** fetches `workout-templates` and `phase-sets` through `cachedFetch` at
`TTL_LONG` in `load()`. The three bare GETs were bypassing a cache the file owns: each set this
screen's React state and left the shared entry holding pre-write data for every other reader. So
after applying a workout review or saving from the builder, Config showed the new programs and
everything else kept the old list until its own TTL expired.

The two `workout-templates` refetches were the same three lines twice, so they collapsed into one
`refreshPrograms`. Both writers invalidate first, so the converted reads miss the cache and go to the
network exactly as before — and if a writer ever stops invalidating, the cached paint self-corrects
on revalidation instead of leaving the entry wrong indefinitely.

`config-screen.tsx` leaves the ratchet baseline entirely: **4 → 0**. Totals **62 → 59**, tracked
**17 → 13** across **14 → 13** files.

## The one that must not convert

`openPhaseSetEditor` needs the sets **in sequence** to build the editor state, and its own comment
says why: the editor saves over whatever it opened with, so a stale set wipes migration-added phases.
`cachedFetch` is callback-shaped, so the cached-then-fresh pair would open the editor on the stale
set and then reopen it. It joins `AUTHORITATIVE_READS` with that reason written out — the population
the script already models for exactly this.

## Why the other six are not debt

- **Four are local-store fallbacks.** `day-checkin` ×3 and `plan-meal-answers` sit behind
  `store.getDayCheckin(...)` / `store.getPlanMealAnswers(...)` and run only where `getLocalStore`
  returns null — the web/dev surface, never the APK. They are also one-shot decision reads ("open the
  check-in sheet or not"), which the cached-then-fresh callback pair does not fit.
- **Two are schedulers.** `day-review-reminders.ts` and `meal-reminders.ts` read `bedtime-estimate` to
  compute a notification time. `cachedFetch` fires `onData` twice on a stale entry, so the conversion
  schedules twice — and `freshWithinTtl` is disqualified because the payload derives from sleep rows
  the BLE rollup writes server-side, which is the same RV-67 failure that disqualified
  `readiness-score`.

Both findings are written into the entry so the next session gets a different question rather than a
retry.

## Verified

- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **955 files, 9,508 passed** · `pnpm build`.
- `e2e/lb186-new-exercise-has-a-style.spec.ts` — **3 passing**; it drives the program editor on this
  screen, which is the surface the converted reads feed.
- `check-component-size` — `config-screen.tsx` is a shrink-only hotspot; the change landed
  **net-neutral at 998 lines**, matching `origin/main`, after two rounds of trimming.

## Not exercised

- **The staleness this fixes, observed end to end.** Showing the old bug needs two screens reading
  `workout-templates` across a write; the unit suite covers the call shape and the e2e covers the
  editor, not the cross-screen staleness.
- **The device.** No native, safe-area or gesture change.

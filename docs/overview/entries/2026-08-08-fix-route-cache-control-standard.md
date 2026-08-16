## 2026-08-08 — route `Cache-Control: max-age` stops outliving client cache-group invalidation (Q-125, v1.270.14)

**Branch:** `fix/route-cache-control-standard` · **Domain:** `platform` / `app-shell`

### What was wrong

The client-side invalidation discipline is genuinely good — zero `invalidateCache` calls exist
outside `lib/cache-groups.ts` — and it was being undone one layer down. A write clears the client
cache entry correctly, the refetch goes out, and the **WebView's own HTTP cache** answers it with the
pre-write body for the rest of the route's `max-age`.

Worst two were `public, max-age=3600` on **session-gated per-user data**: `exercise-library` and
`activity-types`. A newly added exercise stayed invisible in Config, Workout-select, Stats and the
injury-swap picker for up to an hour, despite `invalidateExerciseLibrary()` firing correctly at four
call sites. `public` on a per-user route is wrong independently of the TTL — a shared cache is
entitled to serve one user's exercise library to another.

### What shipped

Ten GET routes moved to the repo standard, `private, max-age=60, stale-while-revalidate=120`:

| Route | Was |
|---|---|
| `exercise-library` | `public, max-age=3600` |
| `activity-types` | `public, max-age=3600` |
| `hr-profile` | `private, max-age=3600, swr=7200` |
| `health-trends` | `private, max-age=300, swr=600` |
| `muscle-tonnage-trend` | `private, max-age=300, swr=600` |
| `user/profile` | `private, max-age=300, swr=600` |
| `cardio-trends` | `private, max-age=300, swr=600` |
| `guided-walk/segment-stats` | `private, max-age=300, swr=600` |
| `running-bests` | `private, max-age=300, swr=600` |
| `running-plan/run-type-stats` | `private, max-age=300, swr=600` |

The last four are **not** in the backlog entry. They belong here because **Q-126 (#1152) is what
makes them live**: that PR adds `cardio-trends`, `walk-segment-stats`, `running-bests` and
`run-type-stats` to `invalidateActivityWrites()`, and a 300 s route `max-age` would defeat the new
invalidation for five minutes after every finished run. Fixing one without the other ships half a
fix. The change is also harmless if merge order flips — a shorter TTL is never wrong for these.

### The criterion used, and what was deliberately left alone

The backlog entry recorded a counterpoint rather than an instruction: **42 of ~48 aggregate GET
routes ship no `Cache-Control` at all**, so CLAUDE.md's "SWR header at creation" rule is broadly
unfollowed — and the entry says explicitly *"decide whether to enforce the rule or narrow it; do not
blanket-add headers."*

The rule was **narrowed, not enforced**. The test applied to each route was: *does a cache group
invalidate this route's client key?* If yes, a long `max-age` actively defeats a correctness
mechanism and is a liability. If no, the header is at worst a missed optimisation, and adding one to
42 routes would be a large speculative change with its own staleness risk. Every route above was
grepped to a `invalidateCache('<key>')` line in `cache-groups.ts` before being touched.

Nothing else was changed. Left alone deliberately: `version` (`public, max-age=300` — genuinely
public, not user data), `body-metadata` and the two `sync/*` routes (`no-store`, correct), the
`running-plan` family (`NO_STORE`), the `oura-ble/*` debug consoles (10–30 s), and everything already
at 30 s (`streak-data`, `calendar-data`, `achievements`, `day-timeline`, `workout-data`) — 30 s is
short enough that it cannot outlive a user-visible write.

### Verification

- `tsc --noEmit` clean · `pnpm lint` 0 errors · `vitest run` full suite green apart from the known
  seeded-local-DB failure in `scale-ble-multi-reading.test.ts` (filed by me as Q-141 — a number already claimed by open PR #1143; correctly refiled as **Q-146**, and since fixed by #1160).
- **Nine of the ten routes hit live against `pnpm dev` as a logged-in user**, reading the real
  response header off each: `exercise-library`, `activity-types`, `hr-profile`, `user/profile`,
  `muscle-tonnage-trend`, `cardio-trends`, `running-bests`, `guided-walk/segment-stats` and
  `running-plan/run-type-stats` all returned 200 with
  `private, max-age=60, stale-while-revalidate=120`. `health-trends` needs a `view` param and was
  checked in source only.

### Not exercised

No device run — response headers only, no native, safe-area, gesture or notification path.

**The staleness itself was not reproduced.** Demonstrating it means watching the WebView's HTTP cache
answer a post-invalidation refetch with a pre-write body — that needs the APK; a headless Chromium
against a dev server does not stand in for it. What is verified is the header each route now emits.
The reasoning that a long `max-age` defeats client invalidation is the review's, restated here — not
independently measured.

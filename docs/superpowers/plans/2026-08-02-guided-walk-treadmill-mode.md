# Guided Walk — Treadmill Mode (no GPS, no polluted pace/distance stats)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (owner request):** let the guided/interval walk be done on a treadmill. Owner's own framing
of the risk: treadmill has no real GPS route/speed, and letting that indoor noise into the same
distance/pace stats as an outdoor walk would corrupt them. Owner proposed either (a) an explicit
free-walk-vs-treadmill choice, or (b) auto-excluding low-quality speed/map data. This plan takes
(a) — explicit choice — because the app already has exactly this convention for manual activity
logging and it's a straight port, not a new invention; (b) alone would still let a treadmill's own
somewhat-real HR/duration data get diluted trying to guess "is this route real," when the user
simply knows which one it is at start time.

**Tech Stack:** Next.js/React client only, reusing existing DB rows/columns. No migration, no
native/Kotlin change.

---

## The existing convention this copies

The "Other activity" manual-logging flow already solved exactly this problem for regular activity
logging, and guided walk (a separate, dedicated flow under `components/guided-walk/`) simply never
got the same treatment:

- `activity_types` has a `treadmill` row with `is_distance_based = false`
  (`lib/data/postgres/migrations/094_treadmill.sql`, corrected in `101_treadmill_not_distance_based.sql`
  — "Treadmill is a stationary machine — it must never be GPS-tracked").
- `lib/stores/activity-store.ts` carries `isDistanceBased` on the active-activity state.
- `components/activity/active-activity-screen.tsx:40` gates the GPS watcher on it:
  `if (!isDistanceBased || isPaused) return`.
- Downstream aggregates already tolerate a null pace/distance safely — `cardio-trends.ts`'s
  `deriveHrPacePairs`/best-effort helpers filter on `avgPaceSecPerKm != null` /
  `distanceKm != null` before including a log, so a treadmill entry with those fields null is
  **automatically and correctly excluded** from pace-based aggregates (best pace, VO2max-from-pace,
  etc.) with no extra filtering logic needed anywhere.

Guided walk (`components/guided-walk/`) never had an indoor mode: `walk-active.tsx` unconditionally
starts `startGpsWatcher(...)`, and `walk-summary.tsx` always saves `activityType: 'walk'`. It
happens to already null the GPS-derived fields defensively when `rawPoints.length < 2`
(`hasRoute` gate in `walk-summary.tsx:128`), which is why an outright GPS failure indoors doesn't
currently crash anything — but it does nothing about **noisy-but-present** indoor fixes (phone
sitting on a treadmill console still gets a wandering, low-confidence lock in a lot of gyms), which
is the owner's actual concern: not "no GPS," but "bad GPS masquerading as real distance/pace."

---

## Fix — add an explicit Treadmill toggle, reusing the activity-store pattern

### Task 1: Add the mode to guided-walk config

**Files:**
- Modify: `lib/walk/interval-plan.ts` (or wherever `WalkConfig`/`DEFAULT_WALK_CONFIG` is typed —
  confirm exact file at implementation time) and `lib/stores/guided-walk-store.ts`

- [ ] Add `indoor: boolean` to `WalkConfig` (default `false` — free/outdoor walk, today's
  behaviour, unchanged for every existing user). Persisted the same way the rest of `config`
  already is (it's already in the persisted Zustand store).

### Task 2: Toggle in the config screen

**Files:**
- Modify: `components/guided-walk/walk-config.tsx`

- [ ] Add a simple switch/segmented control — "Outdoor (GPS)" vs "Treadmill" — near the top of the
  config form, using whatever toggle primitive this screen's siblings already use (check
  `components/ui/` for an existing switch before adding a new one, per the standing "grep
  `components/ui/` before a third copy" rule). Keep the copy short: something like "Treadmill —
  skips GPS, distance and pace" so the trade-off is visible before starting, not discovered after.
- [ ] No change to the preset/sets/fast/slow/warmup/cooldown fields — treadmill mode only affects
  tracking, not the interval structure itself.

### Task 3: Skip GPS in treadmill mode

**Files:**
- Modify: `components/guided-walk/walk-active.tsx`

- [ ] In the GPS-tracking effect (`walk-active.tsx:76-85`), gate exactly like
  `active-activity-screen.tsx:40`: `if (config.indoor) return` before calling
  `startGpsWatcher(...)`. This is the actual fix for the owner's stated concern — no GPS lock is
  even attempted indoors, so there's no drifting fix to pollute anything with in the first place.
- [ ] The pace-primary/HR-primary layout split already in this file
  (`walk-active.tsx:159-161`, "degrades to today's HR-primary layout when no GPS lock exists —
  indoor/treadmill walk") already does the right thing once `currentPaceSecPerKm` never gets set —
  no UI change needed there, it was already written anticipating this case.

### Task 4: Save the walk tagged correctly, and defensively null the GPS fields

**Files:**
- Modify: `components/guided-walk/walk-summary.tsx`

- [ ] Read `config.indoor` (already available via `config` prop) and:
  - Save `activityType: config.indoor ? 'treadmill' : 'walk'` instead of the hardcoded `'walk'`
    (both branches — local `store.upsertActivityLog` and the web-fallback `POST
    /api/activity-logs`), so the row lands under the same `activity_types.treadmill`
    (`is_distance_based=false`) row the manual-logging flow already uses. `title` can stay
    "Interval walk" — activity type drives the icon/label elsewhere, title is just the session name.
  - Force `distanceKm`, `routePolyline`, `splits`, `bestEfforts`, `paceSeries`, `avgPaceSecPerKm`,
    `elevationGainM/LossM`, `elevationProfile` to `null` **when `config.indoor` is true**, in
    addition to (not instead of) the existing `hasRoute` gate — belt-and-suspenders against the
    exact "GPS gets a few noisy indoor fixes" case this plan exists for. Don't rely on `hasRoute`
    alone once GPS is deliberately not started (Task 3 means `rawPoints` should already be empty,
    but this makes the save path itself unconditionally correct regardless of whether GPS
    somehow still produced points).
  - `segments` (per-interval HR/cadence/pace) can stay as computed — `computeWalkSegmentStats`
    already nulls `avgPaceSecPerKm`/`distanceKm` per-segment when there aren't ≥2 route points in
    that window (`lib/walk/segment-stats.ts`), so no change needed there; HR and cadence per
    interval are still real, useful data on a treadmill.

### Task 5: Verification (`pnpm dev`)

- [ ] Start a guided walk in Treadmill mode — confirm no GPS permission prompt appears at all, the
  active screen renders the HR-primary layout throughout (no pace ever appears), and the summary
  screen shows no route map / no pace stats but does show HR-based per-interval stats.
- [ ] Confirm the saved activity shows up in `/activity` tagged as a treadmill activity (not a GPS
  walk with an empty map).
- [ ] Confirm cardio-trends/best-pace views are unaffected by a treadmill session (i.e. it doesn't
  appear as a 0:00/km "best pace" outlier) — this should already hold given the existing
  `!= null` filtering, but verify against real saved data, not just by reading the filter.
- [ ] Confirm an **outdoor** (default) guided walk is completely unchanged — GPS still starts, route
  still saves — this plan must not regress the existing path for the common case.
- [ ] No native/APK change here — GPS start/skip is a JS-side decision using the same
  `startGpsWatcher` already used elsewhere, so a standard `pnpm dev` + on-device sanity check (not a
  full device-verification gate) is sufficient. Still worth a quick real walk on the S25 given GPS
  and live-HR are both device-only paths per CLAUDE.md's Communication rule.

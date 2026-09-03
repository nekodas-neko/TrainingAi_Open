# Nutrition is the one tab that never asks what day it is, and the one tab BF-100 did not reach

**Date:** 2026-09-03 · **Agent:** Review 📖 (sweep 41) · **Pillars:** `[nutrition]` `[app-shell]` `[platform]`
**Lens:** the three the owner named — mobile UI (safe area, back-and-return scroll position) and cache
staleness, swept across the five tab screens rather than one domain.

Two of the three lenses came back with a finding, and both landed on the same file. The third —
safe area — is already held by four CI rules and its residue is device-only, so nothing can originate
from here; §5 says so plainly rather than filling the gap with a guess.

**The shape both findings share:** a mechanism was built once, wired into one place, and described as
if it were global. `useLocalDay()` (BF-86) and `useScrollRestoration` (BF-100) are both correct hooks.
Neither reaches the Nutrition tab.

---

## 1. Method, and what it does not establish

The app was run, not read. `pnpm dev` against the seeded local Postgres, driven through the existing
Playwright harness at the mobile viewport, with Playwright's `page.clock` used to cross local midnight
under a fixed clock. Every claim below is a measurement printed by a probe; the probes were deleted
before committing, and each one's output is quoted where it is used.

Three things this does **not** establish:

- **It is the web build.** `getLocalStore()` returns null, so every offline-first domain took its web
  fallback. **No safe-area, Samsung-WebView, native-plugin or native-SQLite claim can come from here**
  — including the one in §4, which is filed as structural and explicitly *not* observed.
- **Safe-area insets are zero in Chromium.** `env(safe-area-inset-bottom)` resolves to `0px` in the
  harness, so the gesture-bar clearance this app cares about is invisible here by construction. What
  *is* measurable is padding that is absent regardless of inset, which is what §4 reports.
- **It is the seeded fixture, not production.** `/health/day` in particular renders *"Nothing logged on
  this day"*, which is why §4 could not be measured rather than being reported as clean.

---

## 2. RV-35 — Nutrition is the only day-scoped tab that does not follow local midnight

`LocalDayProvider` exists precisely because *"the tab shell is persistent and does not unmount, so an
effect keyed on values that never change runs once per app launch"* (BF-86, its own comment). It
re-evaluates the date on every `visibilitychange`, and subscribers key an effect on `useLocalDay()`.

**Three files consume it.** Two are the provider and its first subscriber; the third is
`session-select-content.tsx`. Nutrition, Health, Workout and More do not.

What the other tabs key on instead is `tabEpoch`, which the shell increments **only when a tab is
re-shown after being hidden**. Resuming the app on the tab you left it on never increments it.

### The measurement

Each tab was loaded at 23:50 Brisbane under a fixed clock, then the clock was advanced 30 minutes and
a `visibilitychange` dispatched — a phone being picked up at 00:20 the next day. Requests carrying a
date were counted on each side.

| Tab | dated requests before (09-03) | dated requests after resume (09-04) | rolls over? |
|---|---|---|---|
| Home `/` | 4 | **2** | ✅ header flips to *Friday 4 September* |
| Health `/health` | 3 | **3** | ✅ |
| Workout `/workout` | 0 | 0 | n/a — issues no dated request |
| **Nutrition `/nutrition`** | **5** | **0** | ❌ |
| More `/more` | 0 | 0 | n/a |

Nutrition is the only tab that is day-scoped *and* fails to roll over. Its five dated fetches stay
pinned to the old day, and a separate capture confirmed the tab issued **no request of any kind**
against the new date on resume.

### What the user sees, and the part that is not cosmetic

The header still reads **`Today`**. It is not a generic label — it is
`formatDateLabel(selectedDate, todayStr)`, which prints `Today` only when the two agree. Both are
frozen at 3 September, because `selectedDate` is a `useState` initialised once
(`nutrition-content.tsx:93`) and `todayStr` is a render-time value on a component that has no reason
to re-render. So the screen shows yesterday's food logs and calls them today's, with no visible tell.

**`selectedDate` is also what a new log is written with** — it is passed as `logDate` to the food
logger (`nutrition-content.tsx:716`) and read as `selectedDateRef.current` on the delete path. A
breakfast logged on this screen after midnight is filed against the previous day, which is the
calorie-budget and adherence input for a day the user has finished.

**Why this is not caught by the existing guard.** Nutrition *does* have a midnight branch
(`nutrition-content.tsx:311–326`) and it is written correctly — it compares `lastVisibleDayRef`
against a fresh `todayInTz(tz)` and follows the day when they differ. Its dependency array is
`[tabEpoch, fetchData, tz]`, and none of those three change on a resume-in-place. The branch is right
and unreachable in the one case it was written for. Switching tabs away and back does fix it, which
is why this would read as intermittent rather than as a bug.

**The class:** the one `CLAUDE.md` records as *"invalidating a key and re-rendering the component that
reads it are two different things"*, with the persistent-shell twist BF-86 already named. Home is the
surface that already does it correctly — one hook call.

---

## 3. RV-36 — scroll restoration covers three screens, and BF-100's entry says it covers all of them

BF-100 shipped `lib/hooks/use-scroll-restoration.ts` and calls it from `pull-to-sync.tsx`. The entry
and the call site both record the reasoning: *"Here rather than in 62 screens, because every screen
using the shell inherits it."*

**Every screen using `PullToSync` inherits it. Three screens use `PullToSync`:**
`health-content.tsx`, `more-content.tsx`, `session-select-content.tsx`. The Nutrition tab owns its own
`overflow-y-auto` container (`nutrition-content.tsx:563`) and is not one of them.

### The measurement

The contrast is one pair of runs, using BF-100's own verified recipe (real wheel scroll, an in-app
`router.push`, then `goBack`):

| Screen | scrolled to | `ta_scroll:` keys saved on push | offset after back |
|---|---|---|---|
| `/more` → *Profile details* → back | 840 | `ta_scroll:/more` present | **840** ✅ |
| `/nutrition` → `/coach` → back | 840 | **`[]`** | **0** ❌ |

`e2e/scroll-restoration.spec.ts` is green today — it asserts `/more`, which is covered. Nothing asserts
the gap.

### The bound, measured rather than assumed

The first draft of this finding claimed the gap covered many screens. It does not, and the difference
came from checking rather than counting. Restoration only matters where a user **pushes deeper and
returns**. Of the routable screens that scroll meaningfully at the mobile viewport —
`/health/sleep` (1200 px), `/health/heart-rate` (661), `/cardio` (374), `/config` (148),
`/program` (148) — **none contains a `router.push` or a `<Link>` to a deeper route**. They are leaves;
you arrive, you leave, and re-entering is a fresh arrival that correctly starts at the top.

So the live gap is exactly one path: **the Nutrition tab, whose single deeper push is
`/coach?scope=nutrition`.** `/workout-select` needs nothing — it does not scroll at all.

That is a smaller finding than "many pages", and it is the honest one. What is worth more than the
finding is the correction to BF-100's entry: a shipped fix records itself as global and covers 3 of 5
tabs, so the next session reading that entry will believe Nutrition is already handled.

---

## 4. Structural, NOT observed — `/health/day` scrolls with no bottom padding

`app/health/day/day-detail-content.tsx:226` is `flex-1 space-y-4 overflow-y-auto scrollbar-hide px-4
pt-4` — no `pb-*` of any kind. The screen is a sub-route, so it carries no bottom nav and nothing is
anchored below the scroller; its last card therefore ends flush with the viewport bottom, which on the
S25's gesture navigation is the gesture bar.

**This was not observed and must not be written up as if it were.** The seeded fixture renders
*"Nothing logged on this day"*, so the container never became scrollable and the probe returned
`found: false`. The control on `/more` measured `padding-bottom: 68px` (`pb-nav-safe` = 56 + 0 inset +
12), which is what a covered scroller looks like.

The four CI rules in the *Custom Rules* job — no hand-rolled `safe-area-inset`, no `pt-safe` stacking,
no `pb-safe*` stacking, no raw `bottom-N` on a fixed element — all pass on this line, because **none of
them fires on an absent utility**. That is the gap this occupies, and it is why it is filed at low
priority with the device check named rather than dropped.

---

## 5. Two lenses that came back clean, which is a result

**The `freshWithinTtl` invalidation proof.** `CLAUDE.md` requires each site to list every write that
changes the payload and show that write's group contains the key; the baton recorded the groups as
unaudited. There are **seven** sites. Two (`workout-select`, `session-select`) already carry written
proofs. The other five were traced to source:

| Key | Sites | Writers | In a group? |
|---|---|---|---|
| `exercise-library` | `add-exercise-sheet`, `config-screen` | `add-exercise-sheet` create + edit, `admin/exercise-manager` | ✅ all call `invalidateExerciseLibrary()` |
| `activity-types` | `activity-type-grid`, `activity-history-card` | `admin/activity-type-manager` | ✅ calls `invalidateActivityTypes()` |
| `progression-styles` | `config-screen` | `config-screen` POST + DELETE | ✅ both call `invalidateProgramStructure()` |

**Clean.** Every writer invalidates. One caveat is worth recording rather than filing: invalidation is
device-local, and `freshWithinTtl` genuinely suppresses the network — measured, three consecutive
visits to `/config` produced `["/api/exercise-library","/api/activity-types"]`, then `[]`, then `[]`.
So a catalogue change made on *another* surface is invisible here for the full `TTL_LONG` of **6
hours**. For a single-user single-device app that is the intended trade; it is noted so the next
session does not rediscover it as a bug.

**Fetch-once effects.** `check-fetch-once-effects.js` reports *12 known effects across 10 files, none
new*, and its CAN-BITE group — permanently mounted, so nothing ever remounts them — is **empty**. The
lens the baton inherited as open is closed. Note that RV-35 is the same *symptom* reached by a
different route: not an effect that never re-runs, but an effect whose dependencies never change.

---

## 6. Filed

| ID | Pillar | What |
|---|---|---|
| **RV-35** | `[nutrition]` `[app-shell]` | Nutrition does not follow local midnight on resume; shows yesterday as "Today" and writes new logs to it |
| **RV-36** | `[app-shell]` `[nutrition]` | Scroll restoration reaches 3 of 5 tabs; BF-100's entry claims all. `/nutrition` → `/coach` → back loses the offset |
| **RV-37** | `[app-shell]` `[platform]` | `/health/day`'s scroller has no bottom padding — structural, needs the device to confirm |

RV-35 and RV-36 are both in `nutrition-content.tsx` and share one verification pass, so they carry
`Batch: nutrition-tab-day-and-scroll`.

## 7. The query and the recipe, so they are not re-derived

Crossing midnight under a fixed clock, which is what made §2 measurable:

```ts
await page.clock.install({ time: new Date('2026-09-03T13:50:00Z') })  // 23:50 Brisbane
await page.goto('/nutrition'); await page.waitForTimeout(6000)
await page.clock.fastForward(30 * 60 * 1000)                          // -> 00:20, next day
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
```

Counting requests by the date they carry is what separates *"the screen refetched"* from *"the screen
refetched the right day"* — Health reissued 11 requests on resume and only 3 carried the new date, so a
raw count would have called Workout and More broken and Health fine, and all three conclusions would
have been wrong.

**Two harness traps this sweep paid for.** `page.goto()` is a hard navigation: React cleanup never
runs, so **no** screen writes a `ta_scroll:` key and every screen looks broken — the first version of
§3's table read `{}` for `/more` too. And a screen with nothing to scroll returns the same
`expected > 0, received 0` as a regression, which is what §4 is honest about rather than around.

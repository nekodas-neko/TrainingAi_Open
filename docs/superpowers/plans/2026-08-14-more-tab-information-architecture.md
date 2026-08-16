# More-tab information architecture — the target structure for Q-232 … Q-237

**Written:** 2026-08-15 · **Domain:** `app-shell` (secondary: `devices`, `nutrition`, `platform`)
**Umbrella for:** Q-232 (More → Profile), Q-233 (Devices), Q-234 (Admin), Q-235 (Program Builder),
Q-237 (Nutrition actions), and the Q-239 per-screen decisions.
**Status:** plan only. Nothing here is implemented.

> **Why this document exists.** Q-232's backlog entry forbids executing it from the entry, because
> the five IA items share one target structure and working them one at a time leaves the app
> half-reorganised in two incompatible directions. This is that structure, plus the order to build
> it in and the traps measured while writing it.

---

## 1. The owner's complaint, stated precisely

> *"there is a lot of pages/settings etc that are just placed randomly (i.e. admin tools, more
> screen, nutrition buttons) … there should be a better way to organise these to match regular app
> standards"*

The 2026-08-14 review's verdict, which this plan accepts: **the screens are fine, the container
layer is not.** Nothing is missing; a lot of it is unfindable. So this is a routing and composition
change, not a redesign. No screen's internals are rewritten by this plan.

---

## 2. The target

```
More                                                      → /more
├─ [avatar header]  name · level · XP · friend code        → /more/profile      (edit profile)
├─ Achievements & Stats                                    → /more/achievements
├─ Program                                                 → /program           (Q-235)
├─ Devices                                                 → /more/devices      (Q-233)
├─ Goals                                                   → /more/goals
├─ Settings                                                → /more/settings
│    Notifications · Appearance · Home layout
├─ Data & Sync                                             → /more/data
│    Sync now · Restore from cloud · Export my data · storage
├─ About                                                   → /more/about
│    version · update check · SW status · APK download · changelog
├─ Send Feedback                                           → sheet, stays in place
├─ Admin                                       admin only  → /admin             (Q-234)
└─ Sign Out
```

`Friends` keeps its segmented tab — it is a peer *view*, not a settings row, and the review did not
fault it.

**Every row is a real sub-route, not an accordion.** That is what makes each one deep-linkable,
back-navigable, and able to carry its own header — and it is what lets `profile-tab.tsx` stop being
one 845-line file without an artificial split.

### Where each of today's sixteen sections goes

> **SUPERSEDED for rows 2–7 — owner decision, 2026-08-16.** `StatsGrid`, `TrophyCase`,
> `AchievementsSection`, "Your Year", the season badges and `GoalsSection` **stay inline on More**.
> `/more/achievements` and `/more/goals` were never built and are not going to be. The size pressure
> that justified the other splits is gone (`profile-tab.tsx` is 465 lines, off the
> `check-component-size.js` baseline), and unlike Settings/Data/About these six are *content* the
> owner wants on the surface rather than navigation. Rows 1 and 8–16 shipped as written. Do not
> re-derive the moves from the table below — it is kept for the record, not as a target.


| # | Today, in `components/more/profile-tab.tsx` | Goes to |
|---|---|---|
| 1 | avatar, name, title, friend code, level, XP (`:353-470`) | More header + `/more/profile` |
| 2 | `StatsGrid` (`:476`) | `/more/achievements` |
| 3 | `TrophyCase` (`:487`) | `/more/achievements` |
| 4 | `AchievementsSection` (`:490`) | `/more/achievements` |
| 5 | "Your Year" → `/year-review` (`:500`) | `/more/achievements` (see §6) |
| 6 | season badges (`:508`) | `/more/achievements` |
| 7 | `GoalsSection` (`:530`) | `/more/goals` |
| 8 | `OuraConnectionSection` (`:533`) | `/more/devices` |
| 9 | `ChestStrapPairing` (`:536`) | `/more/devices` |
| 10 | `ScalePairing` (`:539`) | `/more/devices` |
| 11 | `BackgroundLocationCard` (`:542`) | `/more/devices` |
| 12 | Settings: 6 switches · theme · `HomeWidgetsSection` (`:545+`) | `/more/settings` |
| 13 | About: version · update · SW · APK · **Sync now · Restore · Export** · changelog (`:700+`) | split: `/more/about` and `/more/data` |
| 14 | `FeedbackSection` | sheet from More |
| 15 | Admin entry (`:800`) | More row → `/admin` |
| 16 | Edit Profile · Sign Out (`:820+`) | `/more/profile` · More footer |

**Row 13 is the one that must be split, not moved.** "Restore from cloud" and "Export my data" are
data operations sitting under an About heading with the version string. They are the clearest single
example of the owner's complaint, and they belong on `/more/data` where a destructive-sounding action
reads as one.

### The cost is genuinely low

Every section is already an extracted component. Measured 2026-08-15:

| Component | Lines |
|---|---|
| `components/profile/goals-section.tsx` | 414 |
| `components/more/home-widgets-section.tsx` | 347 |
| `components/profile/achievements-grid.tsx` | 312 |
| `components/settings/scale-pairing.tsx` | 237 |
| `components/more/oura-section.tsx` | 174 |
| `components/more/trophy-case.tsx` | 164 |
| `components/settings/chest-strap-pairing.tsx` | 157 |
| `components/activity/background-location-card.tsx` | 109 |
| `components/more/stats-grid.tsx` | 103 |
| `components/more/feedback-section.tsx` | 36 |

So the work is: create the sub-routes, move the JSX that composes these, and leave the components
themselves untouched. It retires `profile-tab.tsx` (845 lines, one of six
`check-component-size.js` hotspots) as a side effect — **delete its BASELINE row in the same PR**,
per that script's shrink-only rule.

---

## 3. Q-233 — the Devices screen

Four cards live inline between "Goals" and "Settings" today: ring, chest strap, scale, and the
background-location permission. Every wearable app has one Devices screen answering *what is paired,
is it connected, what is its battery, when did it last sync, how do I unpair*.

`/more/devices` composes the four existing components in that order, with no changes to them in the
first pass. **Cross-reference Q-111** (Home header battery chips) — the same question being answered
at the opposite end of the app. Do not build a second battery-reading path here; when Q-111 lands,
this screen reads whatever it establishes.

`BackgroundLocationCard` is a *permission*, not a device. It goes on this screen anyway — it is what
makes activity detection work, and a user looking for "why isn't my walk being detected" looks at
Devices. Group it under its own heading rather than mixing it with the pairing cards.

---

## 4. Q-234 — split the admin console by audience

`app/admin/admin-content.tsx` has nine tabs — `users`, `invites`, `exercises`, `activities`,
`tools`, `day-review`, `feedback`, `errors`, `ai-usage` — plus three sub-consoles reachable only from
inside Tools (`/admin/oura-ble` `:262`, `/admin/cadence` `:273`, `/admin/data-capture` `:284`), plus
a nested "Additional tools" collapsible holding `ExerciseUnitFix`, `SetHrBackfillCard`,
`WorkoutHrBackfillCard` and `ModelAssetsCard`.

Two audiences are stacked in one console:

| Audience | What | Frequency |
|---|---|---|
| **User administration** | users, invites, feedback triage | rare, deliberate |
| **Developer diagnostics** | BLE debug, cadence calibration, data capture, redecode, vacuum, HR backfills, time audit, error log, AI usage, model assets | often — these are debug tools for the owner's own device |

**Target:** `/admin` keeps user administration. Diagnostics move to **Settings → Developer**
(`/more/settings/developer`), visible only to an admin — the standard place for a debug screen — with
the three sub-consoles as **rows on it**, not buttons inside a tab inside a console.

Note the oddity to preserve deliberately or fix deliberately, not by accident: `app/admin/page.tsx`
renders `<BottomNav isAdmin />`, so the console presents as a peer of the five tabs while being
reachable from none of them.

---

## 5. Q-235 — `/program`, and the name collision

`app/more/more-content.tsx:150` renders three segmented tabs — `profile | friends | workout` — and
the third mounts `components/config-screen.tsx`, the 997-line Program Builder. So the app has a
bottom-nav tab called **Workout** and, two containers away, a second tab also called **Workout**.

**Target:** a real `/program` route, reachable from the Workout tab and from More → Program.

### The redirects, and a bug measured while writing this

Today's entry points into the Builder:

| Source | Link |
|---|---|
| `components/coach/handoff-card.tsx:15` | `/config` |
| `app/session-select/components/recommendation-card.tsx:197` | `/config` |
| `components/workout/ai-prescription-card.tsx:337` | `/config?new=program` |
| `components/config-screen.tsx:361` | `history.replaceState(… '/config')` |
| `app/sheet/[id]/config/page.tsx` | `/config` |

**`/config?new=program` is broken today, and Q-235 must not preserve the breakage.** `app/config/page.tsx`
does a bare `redirect('/more?tab=workout')`, which **drops the query string**. `config-screen.tsx:357-364`
reads `?new=program` from `window.location.search` to open the new-program sheet — and never sees it.
Measured in `pnpm dev` on 2026-08-15: navigating to `/config?new=program` lands on
`/more?tab=workout` with the program list showing and **no sheet open**. So the AI prescription
card's post-deload "New program" action silently degrades to "open the Builder". Filed as **Q-256**;
the fix belongs in this work, since Q-235 rewrites these redirects anyway.

This is the same class as **Q-223** — a `/config` shim losing information on the way through — and
it is the second instance. When `/program` exists, it should take its deep-link params as real
route params rather than reading `window.location.search`, so a redirect that forgets to forward
them fails visibly instead of silently.

---

## 6. Q-239 — the six single-entry screens, decided

The deliverable is a decision per screen, not a refactor. Reachability re-measured 2026-08-15
(`href` / `router.push` / `redirect`, excluding each route's own files).

| Screen | Only entry point | Decision | Why |
|---|---|---|---|
| `/baselines` | `components/fitness-tests/latest-baseline-card.tsx:39` | **Leave** | Genuinely the detail view of the card that owns it. The card is on Health → Training, where someone looking for baselines looks. |
| `/year-review` | `components/more/profile-tab.tsx:501` | **Leave, and it moves with §2** | It becomes a row on `/more/achievements`, which is where a yearly retrospective belongs. Reachability stays 1 — correctly. |
| `/session-explain` | `app/session-select/components/recommendation-card.tsx:173` | **Leave** | "Why this session?" is meaningless without the recommendation that prompted it. Promoting it would create a screen with no context. |
| `/health/day` | `app/health/health-content.tsx:537` (calendar day tap) | **Leave** | A day-detail view reached by tapping a day is the correct interaction. Q-247 is already queued to make that screen worth arriving at. |
| `/admin/{cadence,data-capture,oura-ble}` | inside Admin → Tools | **Promote — this is Q-234** | These are the most-used developer tools and the deepest-buried things in the app. They become rows on Settings → Developer. |
| `/running` | 3 taps: Workout → Cardio card → modality picker | **Leave** | The modality picker is a real choice among peers (run / bike / row); shortcutting one of them makes the others look secondary. |

**Five of six are "leave".** That is the honest answer, and writing it down is the point: the next
reachability sweep will surface these same six, and without this table it re-opens the same
question. Only the admin trio was actually misplaced, and it is already Q-234's job.

---

## 7. Q-237 — Nutrition's actions

`app/nutrition/nutrition-content.tsx`, top to bottom today: a **gear** in the header (`:518`)
opening Nutrition Settings · calorie balance · macro ring · meal-plan cards · a **Water** button
mid-scroll (`:612`) · TDEE card · every meal card · then a 2-column grid of **Saved Meals** (`:651`)
and **End of Day** (`:659`) *below all of them* · weekly chart · supplements.

**Target:** one persistent action affordance holding **Log Food · Water · Saved Meals**, placed
directly under the macro ring — above the meal cards, so its position does not depend on how many
meals exist. The gear stays in the header; that part already matches convention.

Two things this plan explicitly does **not** do:

- **"End of Day" does not get relocated by this work.** It is a daily-review feature living in
  Nutrition behind a moon icon, and merging it with Home's "Your Day in Review" banner is **Q-112**,
  which is spec-sized and has its own entry. This plan adds the placement argument to Q-112 and
  otherwise leaves the button where it is. Moving it halfway is worse than either end state.
- **Water's three mounts are not consolidated here.** Home, Health and Nutrition each mount their own
  `WaterLogSheet`; that is convenient and correct. Their *divergent invalidation* is **Q-243**, still
  open, and it is a behaviour fix rather than a layout one.

---

## 8. Build order

The order is chosen so each step is independently mergeable and nothing is half-moved across a merge
boundary.

1. **`/more/devices`** (Q-233) — four existing components onto a new route, remove them from
   `profile-tab.tsx`. Smallest real win, and it proves the sub-route pattern before anything larger
   depends on it.
2. **`/more/settings` + `/more/data` + `/more/about`** (Q-232 part 1) — the split that makes
   "Restore from cloud" stop sharing a heading with the version string.
3. **`/more/achievements` + `/more/goals` + `/more/profile`** (Q-232 part 2) — after this,
   `profile-tab.tsx` is a row list; delete its `check-component-size.js` BASELINE row in that PR.
4. **`/program`** (Q-235 + Q-256) — the route, the redirects, and the dropped-query-param fix.
   Deliberately after the More restructure, so "Program" has a row to be linked from.
5. **Settings → Developer** (Q-234) — needs `/more/settings` to exist, hence last.
6. **Nutrition actions** (Q-237) — independent of all of the above; can run in parallel with any of
   them, since it touches only `nutrition-content.tsx`.

---

## 9. Constraints that will otherwise be rediscovered

- **`app/more/more-content.tsx:49-68` parses `?tab=` twice** — once in a `useState` initializer and
  once in a `useEffect` — and accepts exactly `profile | friends | workout`. **Q-223 was a bug in
  precisely this parser** (`/config` sent `tab=config`, which fell through to the default and looked
  like the link just opened More). Any tab value that stops existing needs its redirect updated in
  the same PR, and an unrecognised value must not silently fall through.
- **Keep `/profile` and `/stats` working.** They already redirect here and the review calls them
  load-bearing (external links, Coach handoff cards, muscle memory).
- **Safe-area on every new route.** Each sub-route gets its own header, so each needs `pt-safe` /
  `pt-safe-or-4`, and any bottom-anchored control needs `pb-safe-action` (nav screens) or
  `pb-safe-action-lg` (navless). The web sandbox renders insets as **0**, so every one of these PRs
  needs an on-device check or an explicit ⚠️ not-device-verified row.
- **Instant paint survives the move.** `profile-tab.tsx` seeds `more-user-profile`, `more-seasons`
  and the achievements payload from cache. Splitting one screen into eight must not turn one warm
  paint into eight cold ones — each sub-route seeds the keys it renders, in a `useEffect`, never a
  `useState` initializer.
- **A tab-resident `useEffect(…, [])` runs once per app launch.** All five tabs stay mounted, so
  mount effects never re-run; More was missed by the original plan and never refreshed at all until
  v1.257.0. New sub-routes use `useRefreshOnTabShow()` or thread `epoch`.
- **Nested controls.** A row that is a tappable card containing another control is
  `<div role="button">`, never a nested `<button>`; and never interactive content inside a real
  `<button>`.
- **This is one lane's territory.** `app/more/**`, `components/more/**`, `components/profile/**`,
  `app/admin/**`, `app/nutrition/nutrition-content.tsx`, `components/config-screen.tsx` and
  `components/shell/tabs.ts` are held by the app-shell lane while this cluster is open.

---

## 10. What this plan does not settle

- **Whether `/more` should keep its segmented tabs at all** once Profile becomes a row list — the
  Friends tab is the only remaining peer. Decide when step 3 lands and the shape is visible.
- **Q-112** (End of Day ↔ Day in Review) and **Q-111** (battery chips) are referenced, not absorbed.
- **The `/sheet/[id]/*` shims** — a separate owner question, filed as **Q-255**.

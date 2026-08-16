# Nav Restructure + Friend System — Design Spec

**Date:** 2026-06-08
**Session:** 68
**Status:** Approved, ready for implementation planning

---

## Overview

Two related changes:

1. **Nav restructure** — reorganise the 5-tab bottom nav, split Nutrition into its own page, give Health three internal tabs, and consolidate profile/achievements/friends/config into a single tabbed "More" page.
2. **Friend system** — add friends, view their profiles, see an activity feed, compare on a leaderboard, show off achievements via titles, trophy case, and shareable cards.

Activity logging (runs, stretching, cardio) is **designed into the data model but deferred to the next session** — see the final section.

---

## 1. Navigation Restructure

### Bottom Nav — 5 Tabs

| Tab | Route | Content |
|-----|-------|---------|
| **Home** | `/` | Dashboard: morning briefing card, readiness card, streak widget, home metric tiles. No session select. |
| **Nutrition** | `/nutrition` | Full nutrition page: food diary, macro ring, saved meals, meal types. Currently lives inside `/health`. |
| **Workout** | `/workout` | Current session-select screen, **unchanged**. Program session cards, start workout, active workout flow. |
| **Health** | `/health` | Three tabbed views: Body · Training · Progress (see §2). |
| **More** | `/more` | Four tabbed views: Profile · Achievements · Friends · Config (see §3). |

### What Moves

- The session-select screen (`/`) moves to `/workout` — content unchanged.
- Nutrition content splits out of `/health` into `/nutrition` — content unchanged, just a new home.
- Stats page is absorbed into Health → Training tab — no longer a standalone route.
- Config screen content moves into More → Config tab.
- Profile page content moves into More → Profile tab.
- Achievements grid moves into More → Achievements tab.

### Home Page (simplified)

After the workout content moves to `/workout`, the Home tab becomes a pure dashboard:
- Morning briefing card
- Readiness / deload card
- Streak + This Week widgets
- Metric tiles (Steps, Sleep, Mood, Water, Weight, Nutrition)
- AI chat entry point

The APK download banner and session carousel are removed from Home and live in Workout.

---

## 2. Health Page — 3 Tabs

MFP-style: one page, horizontal tab bar at the top, scrollable content per tab.

### Body tab
Everything currently on the Health → Body section:
- Weight tile + trend
- Body fat % tile
- Lean mass tile
- BMI tile
- Steps tile
- Distance tile
- Calories burned tile
- Sleep tile
- HRV / RHR / SpO₂ tiles
- Energy balance tile
- Log buttons on each tile
- → Goals link

### Training tab
Everything currently on the Stats page:
- ACWR card
- Training load bars (volume per session, last 4 weeks)
- Volume over time chart
- Session history calendar (tap a day → day-log overlay)
- Weekly session count vs target

### Progress tab
Trend and goal content that currently lives across both Health and Stats:
- Weight chart (7/30/90 day toggle)
- Body fat % chart
- Goal progress bars: steps, water, calories, weight target, BF% target
- Streak history

---

## 3. More Page — 4 Tabs

MFP-style tabbed page, same pattern as Health.

### Profile tab
- Avatar, display name, friend code (`TRN-XXXX`)
- Equipped title + emblem (tap to change)
- Season badges earned
- Edit profile button
- Sign out

### Achievements tab
- Level + XP bar (level label: Novice → Legend)
- Lifetime stats summary (sessions, volume, best streak)
- Trophy case (3 pinned showcase slots — user configurable, tap to swap)
- Full achievement grid by category (unlocked + locked with progress bars)
- Title equip picker (sheet: shows all earned titles with emblems, tap to equip)

### Friends tab
- Default view: **activity feed** (friend achievements unlocked, PRs hit, level-ups — reverse chronological)
- Toggle button: switch to **leaderboard** (weekly / all-time selector; ranks friends by sessions, volume, current streak; "chasing" 👀 indicator when a friend is within 10% of your stat)
- Top-right button: **Manage friends** → opens a bottom sheet with:
  - Pending requests (accept / decline)
  - Current friends list (tap → public profile, long-press → remove)
  - Add friend input (email or friend code)

### Config tab
- Current config screen content: program editor, phase sets, progression sets, advanced settings
- Moved here from the standalone `/config` route

---

## 4. Friend System

### Friend Codes

Each user gets a short alphanumeric code on account creation (`TRN-` + 4 random uppercase alphanumeric chars, e.g. `TRN-4X9K`). Stored as `friend_code` on the `users` table with a unique constraint. Shown on the Profile tab. Used as an alternative to email for adding friends.

### Adding Friends

From the Manage Friends sheet:
- Enter an email address **or** a friend code
- Sends a friend request (status: `pending`)
- Recipient sees it in Manage Friends → Pending
- Accepting sets status to `accepted`; declining deletes the row

Friendship is bidirectional — once accepted, both users can view each other.

### Public Profile Page

Route: `/profile/[userId]`

Visible to any accepted friend. Content:
- Display name + equipped title + emblem
- Level badge
- Lifetime stats: total sessions, total volume, best streak
- Trophy case: their 3 pinned achievement badges (larger showcase render)
- Rarity signal on each trophy case badge: *"2 of your 5 friends have this"*
- Full unlocked achievement grid (locked achievements hidden on friend profiles)
- Achievement progress bars visible — friends can see e.g. "87% to Iron Will"

### Activity Feed

Events surfaced in the feed:
- Achievement unlocked (badge icon + name + XP)
- New personal record (exercise name + weight)
- Level-up
- Season badge earned

Feed is reverse-chronological, scoped to accepted friends only. Fetched fresh on tab visit (no real-time socket needed at this scale).

### Leaderboard

Weekly (Mon–Sun, resets each week) and all-time rankings. Three metrics: sessions, total volume (kg), current streak. Only shows accepted friends + yourself. "Chasing" indicator (👀) appears next to any friend who is within 10% of your stat in a category.

### Rarity Signal

On every achievement badge (in your own grid, trophy case, and public profile), a small label shows: *"X / Y friends"* — how many of your accepted friends have also unlocked it. Computed at fetch time.

### Shareable Milestone Cards

When a 100+ XP achievement unlocks, a **"Share"** button appears on the achievement popover. Tapping generates a styled card (fixed-size div rendered to a screenshot via the browser's native share sheet or a canvas snapshot):
- Achievement name + emblem icon
- App name + user's display name
- Stat context (e.g. "60-day streak" / "100 sessions")

Card is optimised to look good as a 9:16 screenshot for WhatsApp / Instagram stories.

### Weekly Digest Integration

The existing AI weekly summary prompt gains a friends context block: the top friend by volume this week, and whether the user's current streak is ahead of or behind their closest friend. One sentence added to the digest — not a separate call.

### Push Notifications

When a friend unlocks an achievement the current user does not yet have, a push notification fires: *"[Name] just unlocked [Achievement] — can you get it?"*. Uses the existing push notification infrastructure.

---

## 5. Title System

### Equipping a Title

Users pick one title to display. It shows:
- Next to their name on their public profile
- In activity feed events ("Alex · Iron Will unlocked Century Club")
- On their profile tab in More

The title equip picker is a bottom sheet in More → Achievements. Shows all earned titles with their emblem icon. Tap to equip.

### Stored as

`users.equipped_title` — stores the title ID string (e.g. `"iron_will"`). Null = no title shown.

### Title List — Top-Tier Per Category

Titles are computed from the achievements array at render time. If the unlocking achievement is in the user's earned set, the title is available to equip.

| Title ID | Display Name | Unlocking Achievement | Category | Emblem (Lucide) |
|----------|-------------|----------------------|----------|-----------------|
| `iron_will` | Iron Will | 60-day streak | Streaks | Swords |
| `unbroken` | Unbroken | 30-day streak | Streaks | Shield |
| `powerhouse` | Powerhouse | 100k kg volume | Volume | Rocket |
| `iron_beast` | Iron Beast | 50k kg volume | Volume | Dumbbell |
| `the_veteran` | The Veteran | 250 sessions | Workouts | Crown |
| `century_club` | Century Club | 100 sessions | Workouts | Trophy |
| `set_machine` | Set Machine | 5,000 sets | Sets | Zap |
| `pr_machine` | PR Machine | 25 personal records | Records | Diamond |
| `dawn_warrior` | Dawn Warrior | 5 workouts before 7am | Timing | Sunrise |
| `ghost` | Ghost | 5 workouts after 9pm | Timing | Moon |
| `macro_master` | Macro Master | 30-day calorie goal streak | Nutrition | CheckCircle2 |
| `well_rested` | Well Rested | 30-day sleep streak | Sleep | Bed |
| `relentless` | Relentless | Train across 12 months | Consistency | CalendarCheck |
| `road_runner` | Road Runner | 30k steps in a day | Steps | Activity |
| `ultramarathon` | Ultramarathon | 50k steps in a day | Steps | Medal |
| `built_different` | Built Different | Achievements in 5+ categories | Cross | Star |

---

## 6. Achievement Badge Redesign

### Tiers

Based on XP reward value:

| Tier | XP range | Border treatment |
|------|----------|-----------------|
| Bronze | < 50 XP | Warm bronze metallic border |
| Silver | 50–150 XP | Cool silver metallic border |
| Gold | 200+ XP | Gold metallic border + subtle outer glow |

### On Unlock

When the achievements page loads, any newly-unlocked badge gets a brief shimmer animation. "Newly unlocked" is determined by comparing the current unlocked set against a localStorage key (`ta_seen_achievements`, a JSON array of achievement IDs). Badges whose IDs are not yet in the seen set get the shimmer, then the seen set is updated. Implemented as a CSS keyframe (`shimmer` — a diagonal highlight `linear-gradient` with `background-size` animation).

### Trophy Case Render

When a badge is in the trophy case (3 showcase slots on your profile), it renders at a larger size with the tier border more prominent. Tapping opens the same popover but with the rarity signal shown.

---

## 7. Season System

### Schedule

Seasons are calendar quarters: Q1 (Jan–Mar), Q2 (Apr–Jun), Q3 (Jul–Sep), Q4 (Oct–Dec). A cron job (or on-demand trigger) runs at the end of each quarter to snapshot rankings.

### Season Results

At end of season: each user's rank among all their friends (by total sessions for the season) is saved. Badge label: Gold (top 25%), Silver (top 50%), Bronze (rest, provided they trained at least once).

### Display

Season badges appear on the Profile tab under the user's name. Each badge shows the season label (e.g. "Q2 2026") and the tier colour. Tap to see the season leaderboard snapshot.

---

## 8. Data Model

### New Tables

```sql
-- Friend connections
friendships (
  id          uuid primary key default gen_random_uuid(),
  requester_id uuid not null references users(id) on delete cascade,
  addressee_id uuid not null references users(id) on delete cascade,
  status      text not null check (status in ('pending', 'accepted')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (requester_id, addressee_id)
)

-- Season snapshots
seasons (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,  -- e.g. "Q2 2026"
  start_date  date not null,
  end_date    date not null
)

season_results (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references seasons(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  rank        int not null,
  sessions    int not null default 0,
  volume_kg   float not null default 0,
  badge_label text not null check (badge_label in ('Gold', 'Silver', 'Bronze')),
  unique (season_id, user_id)
)
```

### Columns Added to `users`

```sql
alter table users add column if not exists friend_code    text unique;
alter table users add column if not exists equipped_title text;
```

`friend_code` is generated on `upsertUser` if null: `'TRN-' || upper(substring(gen_random_uuid()::text, 1, 4))`.

### No New Table for Achievements

Achievements and titles remain computed on the fly from existing DB data. No `user_achievements` table needed.

---

## 9. New API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/friends` | List accepted friends + pending requests |
| POST | `/api/friends` | Send friend request (body: `{ emailOrCode }`) |
| PATCH | `/api/friends/[id]` | Accept or decline a request |
| DELETE | `/api/friends/[id]` | Remove a friend |
| GET | `/api/friends/feed` | Activity feed events for accepted friends |
| GET | `/api/friends/leaderboard` | Weekly + all-time rankings |
| GET | `/api/profile/[userId]` | Public profile for a friend |
| GET | `/api/seasons` | Current + past season results for the user |

---

## 10. Deferred — Activity Logging (Next Session)

A "Log Activity" button on the Workout tab for unstructured activities (run, cycle, stretch, yoga, swim, HIIT, other).

**Data shape:**
```sql
activity_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  activity_type text not null,  -- 'run' | 'cycle' | 'walk' | 'stretch' | 'yoga' | 'swim' | 'hiit' | 'other'
  duration_min  int not null,
  distance_km   float,
  calories      int,
  notes         text,
  logged_at     timestamptz not null default now()
)
```

Activities count toward:
- Training streak (as a training day)
- History calendar in Health → Training tab
- Activity feed (friend-visible events)
- Calories burned tile on Health → Body tab

**Not in scope this session.** The Workout tab UI should reserve a visible "Log Activity" button as a placeholder that shows a "coming soon" toast when tapped, so the nav slot is obvious from day one.

---

## Component Breakdown

### New components

| Component | Location | Purpose |
|-----------|----------|---------|
| `BottomNav` | `components/bottom-nav.tsx` | 5-tab nav bar, replaces existing nav |
| `MorePage` | `app/more/page.tsx` + `more-content.tsx` | Tabbed More page |
| `FriendsTab` | `components/more/friends-tab.tsx` | Feed + leaderboard toggle |
| `FriendFeed` | `components/more/friend-feed.tsx` | Scrollable activity feed |
| `FriendLeaderboard` | `components/more/friend-leaderboard.tsx` | Ranked friends table |
| `ManageFriendsSheet` | `components/more/manage-friends-sheet.tsx` | Add / accept / remove friends |
| `PublicProfilePage` | `app/profile/[userId]/page.tsx` | Friend's public profile |
| `TrophyCase` | `components/more/trophy-case.tsx` | 3-slot showcase with larger badge render |
| `TitlePickerSheet` | `components/more/title-picker-sheet.tsx` | Equip a title |
| `ShareMilestoneCard` | `components/more/share-milestone-card.tsx` | Screenshot-ready share card |
| `NutritionPage` | `app/nutrition/page.tsx` + `nutrition-content.tsx` | Standalone nutrition page |
| `HealthTabs` | inside `app/health/health-content.tsx` | Body / Training / Progress tab switcher |

### Modified components

| Component | Change |
|-----------|--------|
| `app/health/health-content.tsx` | Add 3-tab switcher; move Progress content in; Training content pulled from stats |
| `components/profile/achievements-grid.tsx` | Add tier border treatment + shimmer keyframe + rarity signal label |
| `components/profile/achievements-grid.tsx` | Trophy case slot picker (tap badge to pin/unpin) |
| `app/session-select/session-select-content.tsx` | Rename/move to workout route; remove nav items that move elsewhere |

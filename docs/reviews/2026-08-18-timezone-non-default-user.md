# Review — the app run as a user who is not in Brisbane

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** timezone correctness for a non-default user
**Findings filed:** Q-477, Q-478 · **Clean results recorded:** two

## Why this lens

The **Timezone** and **Date Arithmetic** sections are the two longest rule blocks in `CLAUDE.md`
after Offline Sync, and the file explains why: *"`new Date().toISOString()` is the obvious,
well-known way… The timezone-aware alternative is app-specific and not visible unless you know to
look for it."* It also names the reason the class keeps escaping review — *"it hid for months because
it is invisible while the device sits in the zone the data was recorded in."*

**Every one of the 30 user rows in the local database is `Australia/Brisbane`.** Ten sweeps have run
under this role and none has ever moved a user out of the default zone and used the app. That is the
exact blind spot the rule describes, so this sweep set a user's timezone to `Pacific/Kiritimati`
(UTC+14), logged in fresh so the JWT carried it, and drove the app.

**Conditions were ideal and will not repeat soon.** At the time of the run, three calendar dates were
simultaneously live: Midway (UTC−11) on **2026-08-17**, UTC and Brisbane on **2026-08-18**, and
Kiritimati (UTC+14) on **2026-08-19**. A wrong "today" therefore shows up as a wrong *date*, not a
subtle off-by-one-hour.

---

## The result, in one line

**The server got it right everywhere I looked. The client did not, and the two now disagree by a
full calendar day.**

| Layer | What it computes | Value for this user |
|---|---|---|
| Server routes | `todayInTz(tz)` from the session | **2026-08-19** ✅ |
| Client — 25 call sites | `todayInTz(tz)` from `useUserTimezone()` | **2026-08-19** ✅ |
| Client — **91** call sites | `todayInTz()`, no argument → `DEFAULT_TZ` | **2026-08-18** ❌ |
| Client — **9** call sites | `localDateString()` → the *device's* zone | **2026-08-18** (here; whatever the phone says) ❌ |

Measured, not inferred:

```
POST /api/day-checkin  (no date)   →  "logDate": "2026-08-19"     ← server, correct
GET  /api/workout-data?tab=<id>    →  "dataDate": "2026-08-19"    ← server, correct
client todayInTz()                 →   2026-08-18                 ← DEFAULT_TZ
```

---

## Finding 1 (Q-477) — the Profile timezone setting is the thing that breaks it

This is the part worth leading with, because it inverts the usual severity argument.

**While a user's timezone is `Australia/Brisbane`, nothing is wrong.** The server computes today in
Brisbane, the client's 91 argument-less calls default to Brisbane, and the two agree. Every user row
in the database is Brisbane, so the app is correct today.

**Setting the timezone is what introduces the bug.** The server immediately honours the new zone; the
91 client call sites do not move. `components/profile/edit-profile-sheet.tsx` exposes the field
with an **"Auto-detect timezone"** button (line 190) — so the intended, one-tap action for any user
who is not in Brisbane, or who travels, is precisely the action that desynchronises their client from
their server.

That is a setting that breaks the app when used correctly, which is a different and worse thing than
a setting nobody has tried.

### Observed on screen

Health → Training, as the Kiritimati user: the **Training Calendar highlights 18** as today and
**Training Load highlights "Tue"**. It was Wednesday the 19th for that user. The marker comes from
`components/calendar-widget.tsx:110`:

```ts
const todayStr = localDateString();     // the DEVICE's zone — a third answer again
```

`localDateString()` (`packages/shared/src/utils.ts:16`) reads `new Date().getFullYear()/getMonth()/
getDate()` — device-local. `CLAUDE.md` already warns about this: *"Client code has two 'today'
sources — `todayInTz()` vs the device's own timezone. Pick one per feature and don't mix them."*
There are three, and the calendar picked the one that follows neither the user's setting nor the
server.

### Scale

125 client call sites resolve "today". **25 use the user's timezone; 100 do not.** The infrastructure
to fix them already exists and is already used — `useUserTimezone()`
(`components/shell/user-timezone-provider.tsx:40`) is a context available anywhere in the tree, and
`components/profile/goals-section.tsx:114` calls `todayInTz(user?.timezone)` correctly. Nothing is
missing except the argument.

### Fix shape

Mechanical but large, and worth a ratchet rather than one heroic PR:

1. **Add a CI rule** rejecting a bare `todayInTz()` / `localDateString()` in client code, with a
   shrink-only per-file baseline — the same shape as `check-hex-literals.js` and
   `check-cache-ttl-divergence.js`, both of which exist because prose alone did not hold a count.
   That freezes the number at 100 and puts every future addition in a diff.
2. **Sweep by surface**, highest-visibility first: the calendar today-marker, the cache today-guards
   (Q-478, which is small and should go first), then the write paths, then display.

Do **not** change `todayInTz`'s default to throw or to read a global — the function is shared with
server code that passes `tz` explicitly, and a global would reintroduce the same ambiguity in a
harder-to-see place.

---

## Finding 2 (Q-478) — two cache guards compare a server date against a client date, so they can never return true for a non-Brisbane user

Small, sharp, and the highest-damage consequence of Q-477. `lib/sqlite/cache.ts`:

```ts
export function isWorkoutDataToday(data) { return data?.dataDate === todayInTz() }        // :369
export function isBodyMetadataFresh(data) { return data?.today == null
                                                 || data.today.date === todayInTz() }     // :361
```

Both compare a **server-stamped** date against a **client `DEFAULT_TZ`** date. Measured: the server
stamps `dataDate: 2026-08-19`; the client compares it to `2026-08-18`; the guard returns **false**,
and will keep returning false for as long as the user's local date differs from Brisbane's.

**How much of the day is that?** For two zones whose offsets differ by Δ hours, the calendar dates
disagree for |Δ| hours out of every 24. Brisbane is UTC+10, so a user in New York (UTC−4 in summer)
is Δ=14 — the guards are false for **14 hours a day**. For Kiritimati, Δ=4.

I planted a real `body_metrics` row on the user's true today and confirmed the guard evaluates false
against a live response:

```
server today row date : 2026-08-19  (steps 7777)
client todayInTz()    : 2026-08-18
isBodyMetadataFresh   : False
```

### What that costs, per call site

- **`app/session-select/session-select-content.tsx:514`** — `if (!isBodyMetadataFresh(data)) return;`
  is an **early return**, and one `setMetaLoading(false)` sits below it.

  > **Corrected 2026-08-18 while fixing Q-478.** This said *"the loading state never clears"*. It
  > does — `fetchMeta` has a **second**, unconditional `setMetaLoading(false)` after the `await
  > cachedFetch(...)` (`session-select-content.tsx:522`), so the skeleton clears when the network
  > round trip lands. What the early return actually costs is the *instant* clear on the cache hit,
  > so the skeleton lingers for a round trip instead of not at all. Still a real regression against
  > the instant-paint rule, and still fixed by passing `tz`; but it is a slow paint, not a stuck one,
  > and the stronger claim would have had the next reader looking for a hang that is not there.
- **`app/health/health-content.tsx:194`** — today's metrics and active energy are set inside the
  guard, so they are never set: the Health screen's today values stay blank while the data sits in
  the response.
- **`components/workout-screen.tsx:324-326`** — `freshExercises` rewrites every exercise to
  `loggedTodayInSession: false` when the guard is false. The workout screen shows every exercise as
  not-yet-logged today, permanently.
- **`app/workout-select/workout-select-content.tsx:31`** — the "Trained today" badge never appears.

That last file is the clearest illustration of the whole sweep. Two adjacent lines inside
`getLastTrainedLabel(session, tz)`:

```ts
if (isWorkoutDataToday(data) && …) return "Trained today";   // :31  DEFAULT_TZ
const todayKey = dayKeyInTz(tz, 0);                          // :32  the user's tz
```

The user's timezone is already a parameter of that function. One line uses it; the line above cannot,
because the helper takes no `tz`.

### Fix shape

Give the three helpers an optional `tz` parameter and pass `useUserTimezone()` at every call site —
about a dozen edits, no behaviour change for a Brisbane user, and it removes the whole class of
compare-server-date-to-client-date. `cachedFetchToday`/`unwrapToday` want the same treatment for
consistency, though they are self-consistent today (see clean results).

---

## Clean results

- **Every API route threads the user's timezone.** Across `app/api/**` there are **zero**
  argument-less `todayInTz()` calls: 53 `todayInTz(tz)`, 4 `todayInTz(session.user?.timezone ??
  DEFAULT_TZ)`, and 4 `formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')`. The rule has held completely
  on the server, which is why this sweep's findings are all client-side.
- **`cachedFetchToday`'s own envelope is self-consistent.** `unwrapToday` (`cache.ts:351`) compares an
  envelope date the client itself wrote at `cache.ts:392` — both `DEFAULT_TZ`, so the guard works. It
  is mislabelled rather than broken: it holds "Brisbane-today" data. Worth fixing alongside Q-478 for
  consistency, but it is not the same defect and should not be filed as one.

## Severity, stated honestly

**Latent for the current user base, structural for the stated direction.** Every user row is
Brisbane, so nothing is broken in production right now, and I did not find evidence that anyone has
set a different zone. What makes it worth filing above "someday" is that the app *ships the button*
that triggers it, `CLAUDE.md`'s 2026-08-02 amendment says explicitly not to assume the owner's own
device, and a Play Store listing is the stated intent. A per-user timezone column, a JWT claim, a
context provider and an auto-detect button all already exist — the feature is built, and 100 of 125
client call sites ignore it.

## Not verified

Local `pnpm dev` in a container whose own clock is UTC. Not on the APK — and note the device-zone
sites (`localDateString()`) will read the *phone's* zone there, which is a third value again and
cannot be reproduced in this harness. Not against production, where all users are Brisbane and the
symptom does not arise.

## Method notes

- **Changing `users.timezone` is not enough** — the zone is stamped into the JWT at login, so a fresh
  sign-in is required before any route sees it. A stale cookie makes the whole test silently pass.
- **Run this when the zones disagree.** Pick a target zone far enough from `DEFAULT_TZ` that the
  *calendar date* differs at the moment of the run; check with
  `TZ=<zone> date +%F` against `TZ=Australia/Brisbane date +%F` first. With an offset that only
  shifts the hour, every symptom above disappears.

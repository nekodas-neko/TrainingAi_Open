# 2026-08-07 — Home's React hydration mismatch (error #418) is fixed

**Domain:** app-shell — v1.267.18, JS-only (no APK rebuild)

## The report

Q-73: minified React error #418 (`args[]=text` — "Text content does not match server-rendered
HTML"), reported by the client error reporter from real browsing. `/` had 283 occurrences since
2026-08-04, running 1–13 a day with no downward trend, first surfaced in the `error_events` review.
Two prior sessions chased this and hit dead ends — see the corrections below.

## Root cause

`app/session-select/session-select-content.tsx:1063` (Home's header date) called:

```tsx
new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })
```

with no `timeZone` option — the exact pattern CLAUDE.md's Timezone section bans by name. Railway
sets no `TZ` environment variable, so Node renders in **UTC**; the S25 renders in
**Australia/Brisbane**. Between 00:00 and 10:00 AEST — 42% of every day — the server's SSR pass
computed yesterday's weekday+date while the client's hydration pass computed today's, producing a
genuine text mismatch on every home-screen load in that window.

## Two false premises corrected

The full-app review that found this root cause (`docs/reviews/2026-08-07-full-app-review.md` §2.1)
also identified why it took two prior sessions to find:

1. **"`/` mounts all five tabs at once"** — false. `components/shell/tab-shell.tsx:57-61`
   initialises `mounted: [initialTab]`; the other four tabs mount only on first client-side
   activation, which cannot hydrate. The search space was always the home tab alone, not all five.
2. **"Needs the un-minified error captured on the device"** — also false. `pnpm dev` runs the Next.js
   server and headless Chromium in the **same** system timezone, so both sides always format
   identically in the sandbox — no device was ever needed, a timezone difference was.

Both premises appeared in this bug's own backlog entry and in its `projectOverview.md` Known-Issues
row; corrected in both places in this PR.

## The fix

```diff
-{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
+{formatInTimeZone(new Date(), DEFAULT_TZ, "EEEE d MMMM")}
```

Deliberately **not** "use the logged-in user's real timezone" — that would still be ambient/session
dependent and could still disagree between an SSR pass (which has the session available) and a
hydration pass (which also has it, but at a different instant) if the underlying value ever
diverged. `DEFAULT_TZ` is a fixed, build-time constant already used throughout this exact file for
the same reason (`aestDateString()`, `todayInTz()` with no argument) — server and client compute
the *identical* string by construction, not by coincidence of matching system clocks.

## Swept the sibling sites

The review flagged three more sites carrying the identical banned pattern:

- `session-select-content.tsx`'s `getGreeting()` — `new Date().getHours()`, device-local. Not
  currently a live mismatch (gated behind a `displayName` that's null on both the server and client
  first render), but the same class, and would greet a travelling user by the wrong period of day.
  Fixed to `parseInt(formatInTimeZone(new Date(), DEFAULT_TZ, "H"), 10)`.
- `components/overview-screen.tsx:308` — identical bare `toLocaleDateString` header date. Fixed the
  same way.
- `components/workout/pre-workout-screen.tsx:114` — identical bare `toLocaleDateString`. Fixed the
  same way.

Not swept: a broader grep turns up a dozen more `toLocaleDateString` call sites in the app, but all
of them format an *explicit stored date* (a session date, a chat timestamp, a sleep-night date) —
a different failure mode from this bug, which was specifically about formatting `new Date()` (the
current instant) in a render body during SSR. That broader class is already queued separately as
Q-130 ("date-handling hardening sweep"); expanding this fix's scope to it would be scope creep
beyond what was root-caused and verified here.

## Verification

`tsc --noEmit -p .` clean (only the pre-existing unrelated `voice-log-button.tsx` error). `eslint`
on all three touched files matches the pre-existing baseline exactly. Full suite: 404 files / 3192
tests green.

**Live-verified crossing the actual bug window, by chance.** This session's real wall-clock crossed
the UTC/AEST midnight boundary mid-verification (UTC was still 2026-08-07, Brisbane had already
rolled to 2026-08-08) — exactly the 42%-of-day window the bug depends on. A Playwright pass run
immediately after editing (before restarting the dev server) caught a genuine hydration error:
`+ Friday 7 August` (client) vs `- Saturday 8 August` (server). Diagnosed as a stale Next.js
dev-server compile from before the fix — confirmed by clearing `.next` and rebuilding, after which
a clean pass showed **zero hydration errors** and `"Saturday 8 August"` consistently on both the
server-rendered HTML and the hydrated client. Re-verified `overview-screen.tsx` and
`pre-workout-screen.tsx` the same way afterward — both render the corrected date with no console
errors.

No on-device S25 verification — the fix is a pure date-formatting change with no
native/safe-area/gesture involvement, and the mechanism (server-tz vs client-tz divergence) was
directly reproduced in the sandbox this time, which is itself the noteworthy part: `pnpm dev`
normally can't catch this class of bug at all, since dev server and headless Chromium usually share
one system timezone — this run only caught it because of the lucky timing of the real UTC/AEST
crossover.

# 2026-09-23 — LB-131 + DV-9: two sleep surfaces took Brisbane by default

**Branch:** `fix/lb131-dv9-sleep-timezone` · **Lane:** B · two call sites, one test

`computeSleepStartConsistency(starts, tz = DEFAULT_TZ)` and `timingPoints(nights, mode, tz =
DEFAULT_TZ)` both already accepted a zone. Nothing on the client passed one, so the Sleep screen's
consistency figure was computed in the **device's** clock and the timing chart's axes in Brisbane —
correct for the only user today, wrong the moment a phone and a profile disagree.

This is the shape CLAUDE.md names outright: *a default every caller overrides is a safety net, and
it is what makes forgetting silent.* Neither surface looked broken, and neither would until someone
travelled.

## Shipped as one PR, because the entry asked for it

LB-131 said "ships with DV-9 — one tz resolved once per screen, not twice", and they touch the same
screen, so they batch on the axis that matters: one device look clears both.

## Built differently from the plan, deliberately

The entry prescribed threading the session timezone from the screen through into the card. The card
is rendered by `sleep-trend-toggle-card.tsx`, which has no other use for a zone — so a threaded prop
is a parameter a future render site can omit, which is **the same hazard as the default**, moved one
level up. The card reads `useUserTimezone()` instead: a context fed from the root layout's `auth()`
call, present in the first server render, so the card is correct wherever it is mounted.

Reversal cost is a prop and two edits. Recorded in the entry as well as here, per the standing rule
that a structural call gets written down with its reason.

## The sweep found the intermediary, and no third site

Neither entry mentioned `sleep-trend-toggle-card.tsx`; grepping the render chain did. Between `app/`
and `components/` each helper has exactly two call sites, and the API route's
(`app/api/user/bedtime-estimate`) was already passing a zone — which is what made the client half
look deliberate rather than missed.

## The test guards the call sites, not the maths

DV-7 already pinned the helpers themselves with explicit `+10:00` fixtures passing under UTC,
Brisbane, New York and `Etc/GMT-13`. What had no guard is whether anything *passes* a zone, which is
exactly what regressed. `components/health/__tests__/lb131-dv9-sleep-tz-call-sites.test.ts` sweeps
every client call site of both helpers and also asserts the value comes from `useUserTimezone()`
rather than a hardcoded string or an `Intl` read — either would typecheck and be the bug.

**A first draft matched one line at a time** and reported the API route's three-line call as having
no zone. That is a false positive, not a find: the `tz` was on the third line. The check now reads
each call to its balanced closing paren.

**Control runs:** reverting either call site fails the sweep; hardcoding `'Australia/Brisbane'`
fails the session-source assertion. All three restore green.

## Not done, and not claimed

**Both keep a `Verify: device`.** DV-9's pass test is the one assertion the sandbox structurally
cannot make — override the device timezone (CDP `Emulation.setTimezoneOverride`), leave the profile
alone, and the consistency figure must NOT move. That needs two clocks that disagree. LB-131's is
the owner setting a profile zone far from Brisbane and watching both chart axes follow the profile.

Also not exercised: Samsung WebView rendering, native SQLite / Capacitor, drifted production data.

# 2026-08-08 — Lens 12 + empty states: a second user, driven rather than reasoned about

**Branch:** `claude/token-usage-strategy-7cx7z9` · **Domains:** `platform`, `app-shell`

## What this was

Lens 12 and the empty-state half of Step 1, closing out the deep-review run after
[Step 0 + 1](2026-08-08-running-app-review.md), [lenses 9 + 11](2026-08-08-claude-md-and-test-suite-lenses.md)
and [lens 10](2026-08-08-mobile-ui-standards-lens.md).

A second account was **seeded and used**: `userb@local.dev`, `America/New_York`, no program, no logs,
no ring. Every prior review reasoned about multi-user behaviour from source.

## The finding — and it is the fourth of its kind

At the moment of the test it was **18:52 Saturday** for user B in New York, and **08:52 Sunday** in
Brisbane. The app showed them **"Sunday 9 August"** and **"Good morning."** A full day wrong, on the
first thing they see.

Four client sites hardcode `DEFAULT_TZ` (`session-select-content.tsx:94` and `:1064`,
`overview-screen.tsx:308`, `pre-workout-screen.tsx:126`).

**What makes this worth more than a bug report** is why three correct prior fixes all missed it.
Q-148 shipped a `UserTimezoneProvider` *the same day* — none of these four consumes it. And
`session-select-content.tsx:99-100` carries a comment explicitly defending the hardcode, on the
grounds that *"the server buckets workout/rest days in AEST regardless of device timezone, so the
client must key off the same source"*. **That was true when written. Q-144 made it false** — the
server now buckets in the user's zone. So the client is faithfully matching a contract that no longer
exists, and the comment reads as a reason to leave it alone.

A fix that changes the four call sites and leaves the comment will invite a fifth recurrence. Filed as
**Q-163** with that stated as part of the work.

## Two clean results, both worth recording

**Cross-user isolation, tested by attack.** Seeded distinctive rows owned by user A, logged in as B,
and went after them: four read probes (404/401/404/404) and five write probes at A's injury and
program (401/401/404/404/404). Nothing leaked, and A's rows were **verified unchanged afterwards**.
This corroborates the 2026-08-07 read-based verdict with evidence — worth having in the class where
an unverified assumption costs the most.

**Empty states, and a hypothesis eliminated.** Every page driven as a zero-data user renders with no
`pageerror`. Production carries two unexplained client-crash bursts (`Cannot read properties of null`,
`.reduce is not a function`) and "screens that only ever meet the populated seed" was the leading
suspect. **It is not that.** That does not explain them, but it removes the obvious candidate and
saves the next session the experiment.

## Something learned by getting it wrong

The first empty-state attempt failed — user B logged in, then every route bounced to `/sign-in`. Not a
bug: `users.is_active` defaults to **false** and `middleware.ts:23-26` redirects inactive users to
`/pending`. The app is **invite-gated by default**.

Correct for a single-owner deployment, and worth writing down anyway: a Play Store self-service signup
would have to change exactly this gate, and today a brand-new account's entire experience is the
`/pending` screen.

## Not done

The rest of Step 1 — adversarial values (0 kg, 999 kg, negative reps, 26-hour sleep, emoji/RTL text),
boundary dates (23:59:59 vs 00:00:01, month-end, leap year), offline behaviour, rapid double-tap —
needs write flows rather than page loads and was not reached. No device, no APK, no native SQLite, so
the offline-first device path remains untested.

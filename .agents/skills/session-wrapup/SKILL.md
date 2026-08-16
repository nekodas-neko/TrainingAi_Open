---
name: session-wrapup
description: Use this skill at the end of a development session that's about to merge user-visible changes to main — when bumping package.json's version, adding a lib/changelog.ts entry, and updating projectOverview.md. Also trigger when the user says "wrap up", "document this session", "update the changelog", "what should go in projectOverview", or "ready to merge".
---

# Session Wrap-Up: Version, Changelog & Project Overview

Per CLAUDE.md, every session that ships a user-visible change to `main` updates three files together. Do this **after** the user confirms the merge to main (CLAUDE.md: never merge without explicit confirmation).

## 1. `package.json` version bump

Semver discipline:
- **patch** (`1.33.0` → `1.33.1`) — bug fixes
- **minor** (`1.33.0` → `1.34.0`) — new features
- **major** — breaking changes or large redesigns

## 2. `lib/changelog.ts`

Add a new entry at the **front** of the `CHANGELOG` array (newest-first; `CURRENT_VERSION = CHANGELOG[0].version`):

```ts
{
  version: "1.34.0",
  date: "YYYY-MM-DD",   // use todayInTz() if generating programmatically — see timezone-handling skill
  changes: [
    "User-facing sentence describing what changed, in plain language",
  ],
},
```

Match the existing tone — these are read by the end user (yourself). Describe the *visible* change ("Tapping a friend now opens their profile — avatar, level, stats, trophy case"), not the implementation ("added `/api/profile/[userId]` route"). Bug fixes should name the symptom that's now fixed, not just the cause.

## 3. `projectOverview.md`

- Bump the `Last updated:` line at the top and the session number
- Add a new `### Session N — <Title> (YYYY-MM-DD) ✅ Complete` entry under **Past Changes**, including:
  - What was implemented and why (1-2 sentences of context)
  - Key files/modules touched, with enough detail that a future session can find them
  - **Verification** — exactly which checks ran and passed (`pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`, Playwright smoke tests)
  - **⚠️ Pending on-device verification** — bullet list of anything that needs the real Galaxy S25 Ultra / APK and couldn't be tested in the sandbox (native plugins, notifications, GPS, etc.)
- Add a row to the version history table near the top
- **Tick roadmap checkboxes to ✅ immediately** when the feature lands on main — even if on-device testing is pending. Add an inline ⚠️ note for what's still unverified rather than leaving the item unchecked. Never leave a shipped item unchecked because "it isn't fully verified yet"
- If the session found (but didn't fix) a bug, add it to **Known Issues** with the next sequential id in its category: `H` = hardware/health-connect/native, `B` = general bug, `S` = security

## Exceptions (commit straight to `main`, no feature branch, no confirmation needed)

- Documentation-only changes (any `.md` files)
- Implementation plans under `docs/superpowers/plans/`
- Bug fixes for features already merged & deployed to `main`

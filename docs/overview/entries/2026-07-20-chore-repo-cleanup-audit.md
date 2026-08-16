# 2026-07-20 — Repo hygiene + architecture audit (docs-only)

**Branch:** `chore/repo-cleanup-audit` · No version bump (no user-visible change).

## What & why

A documentation/repo-hygiene sweep — no code touched. Three workstreams:

### A. `projectOverview.md` trimmed back to a lean index (5237 → ~1240 lines)
The "🔖 Current Status" section had grown into a single run-on **"Previously — … Previously — …"
chain (298 occurrences, ~3,970 lines)** — a full session-by-session changelog living in the file that
is supposed to be a lean orientation index. That history is already captured in the session journal
(`docs/overview/entries/` + the batched `history-*.md`), so the chain was pure duplication. Replaced it
with a short current-status pointer block (current version, "everything sandbox-buildable is done",
pointer to `owner-action-required.md` and the journal). Also pruned four **fully-resolved** rows from
"Known Issues & Risks" (AI-prescription "couldn't generate" RESOLVED, AI-chat "Invalid input" FIXED,
Culling Lever 1b device-verified, Live-HR DHR burst verified) — a Known-Issues list is for *live*
issues; each was collapsed to a one-line bullet in the existing "Recently resolved" subsection. All
"shipped, NOT device-verified" rows were **kept** (they're live pending-verification and cross-referenced
by `owner-action-required.md`).

### B. Journal compaction — 69 loose entries → one batched archive
`docs/overview/entries/` held **69 files / 356 KB**, far over the compaction threshold documented in its
README (≥20 files / ~100 KB). Folded them (newest-first) into a new
`docs/overview/history-2026-07-20.md` (~244 KB) and `git rm`'d the loose files (README kept). Fixed two
relative links inside the folded content that broke when the content moved up one directory level
(`../../superpowers/plans/` → `../superpowers/plans/`). Document Map updated to list the new batch.

### C. CLAUDE.md — fixed 3 stale file references
A full audit of every file path / symbol / CI-script / migration-number citation in CLAUDE.md
(~90 references) found **only 3 stale**, all now fixed: `lib/session.ts` → `auth.ts` (`@/auth`, the
NextAuth config; the old custom JWT module was removed long ago); `components/workout/confirm-leave-dialog.tsx`
→ `components/workout/leave-workout-dialog.tsx` (renamed); and the phantom `PAGE_GRADIENTS` symbol in the
hero-gradient rule (only `HERO_GRADIENTS` exists, in `components/health/detail-hero.tsx`). The rest of
CLAUDE.md verified accurate — the load-bearing strict rules were left untouched.

### Root tidy
Moved the stray root `mockup-themes.html` into `design-mockups/` alongside the other mockups (0 inbound
references).

## Verification
- `pnpm lint` → 0 errors (pre-existing warnings only); `pnpm exec tsc --noEmit` → clean. No code changed,
  so Build/Custom-Rules/Migration-Check are unaffected (CI confirms on the PR).
- Markdown link integrity checked across every changed doc — all links resolve; no inbound reference to a
  deleted entry file remains.

## Deliberately NOT done (flagged for owner decision — see PR description)
Regrouping the load-bearing loose `docs/oura-*` / `sleep-system` / `body-battery-tuning` docs into
subfolders, and archiving the ~140 implemented plans in `docs/superpowers/plans/` — both would require
editing CLAUDE.md links and code provenance comments (breaking the docs-only guarantee) for tidiness-only
gain, so they were left in place and flagged instead. `agents.md` (root, duplicates a CLAUDE.md subset,
0 refs) also left for the owner to decide.

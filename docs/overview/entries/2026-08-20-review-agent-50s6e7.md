# Review sweep 40 — the non-workout write surface, and the first audit of ownership rule (b)

**Branch:** `claude/review-agent-50s6e7` · **Agent:** Review 📖 · **Date:** 2026-08-20 · **Docs-only.**

**Lens:** the write surface every earlier sweep left — the program / phase-set / progression-style /
template routes — plus `CLAUDE.md`'s write-path ownership **rule (b)**, the one of the three that the
baton recorded as having no evidence behind it.

**Write-up:** [`docs/reviews/2026-08-20-non-workout-write-surface-ownership.md`](../../reviews/2026-08-20-non-workout-write-surface-ownership.md)

## What was found

- **RV-32** — `POST /api/phase-sets`, `POST /api/workout-templates` and `POST /api/log-exercise` each
  persist a `progression_styles` id owned by another user. `PUT /api/phase-sets/[id]` refuses the
  identical value 400. The unscoped join at `programs.ts:427` then hands the other account's style
  **name** back through `GET /api/phase-sets`, and that field reaches the builder-review UI and an LLM
  prompt. Bounded there — every other read of the table is `user_id`-scoped.
- **RV-34** — a client-supplied `program_sessions.id` belonging to someone else is a raw `pg 23505` 500
  and an `error_events` row. Batched with RV-32.
- **RV-33** — `POST /api/progression-styles` and `PATCH /api/nutrition/food-logs/[id]` answer a correct
  ownership refusal with an **empty-bodied 500**, filed into `error_events` as a server fault.

## What came back clean

**Rule (b) is clean** — 116 mutating routes, 325 `.set()` sites, the 21 taking a bare identifier or
spread traced to source; every one is built field by field, and a live probe sending `isAdmin`, `id`
and `passwordHash` to `PATCH /api/user/profile` changed none of them. Also clean: `PUT`/`DELETE
/api/phase-sets/[id]`, Q-129's program-id guard (verified live), `saveProgressionStyle`'s row-count
guard, `saveThread`, `foodLogRefsValid` on both its paths, `weekly-volume`'s programId check, and the
Config screen driven end-to-end as a second account with no console error and no 4xx.

## Method

`pnpm dev` on the seeded local Postgres, two real signed-in accounts, every probe a live HTTP request
and every result read back out of Postgres. Production checked through `claude_ro` for evidence of
exploitation — none in the owner's rows, which is the only account that view can show. Web build only,
so no device, safe-area or native-SQLite claim comes from here.

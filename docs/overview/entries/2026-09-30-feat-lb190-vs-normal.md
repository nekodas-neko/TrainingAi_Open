# 2026-09-30 — LB-190: `vs_yesterday` is `vs_normal`, and every answer records the question it answered

**Branch:** `feat/lb190-vs-normal` · **Lane A** · migration `202609301320`, local SQLite v46.
Unblocks **OR-206** (the copy change), which waited on this via `Needs:`.

## Why

OR-206 changes the morning question from "compared to yesterday" to "compared to normal". Those are
different measurements, and nothing marked which rows answered which. A deploy date cannot mark it,
because Railway ships on merge and one local day can hold rows from both sides.

## What changed

- **Postgres:** `vs_yesterday` is renamed to `vs_normal` (idempotent `DO` block), with a new nullable
  `vs_question smallint`. The 4 stored answers are backfilled as question 1, and a CHECK keeps an
  answer and its question together. **The first draft of that CHECK let an answer through with no
  question**: `NULL IN (1, 2)` is NULL and a CHECK passes on NULL. The real-Postgres test caught it,
  and `vs_question IS NOT NULL` is now explicit.
- **Shared:** `VS_QUESTION` / `CURRENT_VS_QUESTION` (types) and `resolveVsAnswer` (validation).
  Both write paths, the web route and `pushMutations`, store the pair through it. **The pre-rename
  `vsYesterday` key is still accepted**, because an outbox mutation queued before this deployed carries
  it, and it resolves to question 1. It is the one place app code still spells the old name.
- **Local SQLite v46** adds and copies rather than renaming, so a half-applied upgrade is repaired
  by `RECONCILE_COLUMNS` like every other column. `vs_yesterday` stays in the CREATE body as a legacy
  column, so the copy runs on every device.
- The rename runs through types, the local store, the pull mapper, the morning sheet (which sends
  `vsQuestion` only beside an answer, because the schema takes no null there) and `VsNormalPicker`
  (file renamed). The on-screen copy is unchanged: that is OR-206.

## Verified

- `lb190-vs-normal-question.test.ts`: `resolveVsAnswer`, a pushed pair, a legacy-key push stored as
  question 1, a repository read-back, and both CHECK directions. `migrations.test.ts` covers v46.
  LA-137's pull test now pins `vs_question` too. Postgres, local-store, sqlite, check-in and API
  suites: 4,397 passed. tsc, test typecheck and `check:rules` (86 of 86) are clean.
- Migration applied to the owner's snapshot: **4 answered rows → 4 marked question 1 (predicted 4)**,
  100 unanswered rows left NULL. Re-applied on a database that already had it, it is a no-op.
- `pnpm dev` on the snapshot: `POST /api/day-checkin` stored `vsNormal` with question 1, the legacy
  key stored as question 1, and `vsQuestion: 7` was refused. Rows removed afterwards.

## Not exercised

Local v46 on the APK (Known-Issues row added).

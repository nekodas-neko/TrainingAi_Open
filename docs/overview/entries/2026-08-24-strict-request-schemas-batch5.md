# Strict-request-schema sweep, batch 5: 67 → 40 (Q-464)

**Branch:** `fix/strict-request-schemas-batch5` · **Lane A**

## What shipped

Continued the Q-464 ratchet (`scripts/check-strict-request-schemas.js`) that turns a mistyped or
renamed request key from a silently-dropped field into a 400 at the boundary. 16 files reached
zero non-strict schemas and were removed from the baseline: `activity-logs` (DELETE and the
metrics PATCH), `exercise-estimates`, `exercises` (create), `nutrition/dietary-restrictions`,
`nutrition/targets`, `running-plan/explain`, `workout-review/session/[sessionId]/apply`, five
`nutrition/meal-plans` routes, and the shared `packages/shared/src/validation/generated-program.ts`.
Four more (`builder-chat`, `exercises/generate`, `generate-program`,
`nutrition/meal-plans/generate{,/meal}`) were lowered to their `generateObject` response-schema
remainder — their one genuine request schema is now strict, the schemas that constrain the model's
own output are correctly left alone (that's a different decision, not this ratchet's job).

Every conversion read the real client's payload against the tightened schema before touching it —
no codemod, per the entry's own standing warning.

## Two traps caught before shipping

Same class as the prior batch's `push/subscribe` `expirationTime` miss — a field the client sends
that the schema didn't name, which `.strict()` would have silently rejected in production:

- `workout-review-sheet.tsx` sends an unread `confidence` alongside its real fields to
  `workout-review/session/[sessionId]/apply`. Added to the schema as an accepted-but-ignored field
  (the route already computes its own deterministic confidence, per CLAUDE.md's rule that no
  LLM self-reported number may gate an automatic action), rather than exempting the route.
- `builder-review.tsx` mints a `clientId` on every exercise in its live `program` state — the
  review editor's React key — and sends that whole state to `/api/builder-chat`. The field lives on
  the shared `GeneratedExerciseSchema` in `packages/shared/src/validation/generated-program.ts`,
  used only as a request-side schema there; it would have 400'd every real chat turn.

## Verification

- Each client verified by reading its actual fetch call against the schema being tightened — the
  full list is in the `docs/implementation-backlog.md` Q-464 entry.
- The touched routes' own vitest suites: 81 tests across 8 files, all passing.
- Full suite: 4693 passed, 51 skipped, 2 pre-existing unrelated failures (missing `qrcode` package
  in this sandbox).
- `pnpm check:rules` — Ran 55 of 55.
- `tsc --noEmit` clean.

## Not exercised

**`pnpm dev` could not be run in this sandbox** — same gap as the prior batch, `node_modules` is
missing `@sentry/nextjs` despite `package.json` declaring it, unrelated to this change. Static
verification (reading every real client's payload against the tightened schema, confirmed against
the actual field names sent — not assumed from a type declaration) stood in for it, as it did last
time. No route in this batch was hit with a live request in this session.

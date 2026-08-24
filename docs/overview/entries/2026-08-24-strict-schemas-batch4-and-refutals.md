# 2026-08-24 — eight more strict schemas (Q-464 sweep, 75 → 67), plus two queue corrections

**Branch:** `claude/implementation-lane-a-setup-p3f5zk` · **Lane A** · eight routes, no migration, no APK.

Continues the Q-464 sweep: `workout-sessions` DELETE, `fitness-tests` DELETE, `exercise-gif` GET,
`nutrition/barcode` GET, `nutrition/meal-types` POST, `push/subscribe` POST, `user/goals` PATCH,
`user/profile` PATCH.

| route | client | keys sent |
|---|---|---|
| `workout-sessions` DELETE | none found in-repo | `{workoutSessionId}` |
| `fitness-tests` DELETE | none found in-repo | `{id}` |
| `exercise-gif` GET | route builds the object from `searchParams` | `{name}` |
| `nutrition/barcode` GET | route builds the object from `searchParams` | `{code}` |
| `nutrition/meal-types` POST | `meal-type-manager.tsx` `addNew()` | 7 fields, exact match |
| `push/subscribe` POST | `lib/push-client.ts`, `PushSubscriptionJSON.toJSON()` | `{endpoint, expirationTime, keys}` |
| `user/goals` PATCH | `goals-section.tsx`, `goal-recommendation-sheet.tsx` | subsets of 9 named fields |
| `user/profile` PATCH | `edit-profile-sheet.tsx`, `goals-section.tsx`, `goal-recommendation-sheet.tsx` | subsets of 8 named fields |

## The trap worth carrying forward

`push/subscribe`'s real client is not a hand-built object — it's a browser `PushSubscriptionJSON`
(`sub.toJSON()`), which always carries `expirationTime` beside `endpoint`/`keys` per the DOM spec.
The schema named only two of the three keys. `.strict()` as first written would have 400'd every
real subscribe — the exact failure mode this sweep exists to prevent, introduced by the sweep
itself. Fixed by adding `expirationTime: z.union([z.number(), z.null()]).optional()` to the schema,
not by exempting the route. Caught by reading the client's actual runtime object, not by reading
its call site — the call site (`sub.toJSON()`) gives no hint of the shape without knowing the DOM
API it's calling.

## Two queue entries corrected, not implemented

**Q-420** (drop the session-RPE prompt, derive intensity from set RPEs) turned out to already be
shipped — `packages/shared/src/workout/derive-session-rpe.ts` (#368) does exactly what the owner's
2026-08-23 decision asked for, wired into `health-trends`'s `session-rpe` view. The entry's
`Lane: A` tag was stale; corrected to `Lane: B` (the one thing left is deleting the prompt in
`done-screen.tsx`, a `components/**` file) with a pointer to what's actually still open (the
HR+RPE correction formula, gated on Q-422/Tuning).

**Q-556** (`DELETE /api/activity-logs` reports success for a delete that deleted nothing) — the
prescribed remaining fix, "answer 404 on a miss," directly contradicts a same-day review
(`docs/reviews/2026-08-18-write-surface-not-found.md` §Clean item 2) that drove this *exact* route
cross-user and explicitly declined to file the 200-on-miss behaviour as a bug, naming it
deliberate idempotent-DELETE semantics alongside seven sibling routes. Re-verifying against `main`
surfaced the contradiction; the later review actually drove the route live and is the one to
trust. Marked refuted rather than implemented — no code change made to the route beyond what had
already shipped (the `deleted` field in the response body, which stays).

## Verified

- `pnpm check:rules` — 55 of 55.
- `check-strict-request-schemas` — 67 non-strict across 41 files, baseline held (all eight
  converted rows deleted).
- Targeted vitest: `clear-a-goal`, `goal-write-invalidation`, `cache-groups`,
  `auth-before-param-validation`, `not-found-status`, `sentry-scrub` — all green.
- `tsc --noEmit` clean on every touched file.

**Failure surfaces NOT exercised:** `pnpm dev` could not run this session — the sandbox's
`node_modules` is missing `@sentry/nextjs` despite `package.json` declaring it, unrelated to this
change and not investigated further. Verification here is static (every real client's payload read
against its tightened schema) rather than a live round-trip. Nothing device, native, safe-area or
offline is touched by this batch.

# 2026-08-18 — a session-RPE write that matched nothing is no longer a success (Q-460)

**Lane A** · branch `fix/session-rpe-no-match` · adapter + route, no migration, no Kotlin, no APK.

`setSessionRpe` is user-scoped, and that half is **correct** — a cross-account call matches zero rows
and changes nothing. The defect is that **both callers treated "matched nothing" as success.**

Measured live, three ways (review sweep, against a second real account):

| Call | Result | Row after |
|---|---|---|
| user B → user A's real session | `200 {"success":true}` | A's `session_rpe` **still NULL** |
| fabricated UUID | `200 {"success":true}` | no such row |
| A → A's own session (control) | `200` | written |

## On device it is worse than a wrong status code

`done-screen.tsx` writes locally and queues a `session_rpe` outbox mutation. `pushMutations` did
`await this.setSessionRpe(...)` then **`processed++` unconditionally** — so a mutation whose session
row is absent server-side was counted as processed and removed from the outbox. Local kept the RPE,
the server never got it, nothing retried. Permanent divergence with no error surface.

## The fix

`setSessionRpe` returns whether a row was updated. The route answers **404**; the push branch pushes
to `errors` and does not count it.

**`errors` is the right channel and not a quarantine** — which is the part worth checking before
copying this shape. The client gives a failed mutation bounded retries with backoff (30 s → 2 m →
8 m → 32 m, `MAX_MUTATION_ATTEMPTS = 5`) and then dead-letters it. So the common transient case — an
RPE pushed before the session that carries it — succeeds on a later attempt, and a genuinely orphaned
one becomes visible instead of vanishing.

The web fallback in `done-screen.tsx` already does `if (!res.ok) throw new Error()`, so the 404 makes
it honest with **no Lane B change needed**.

## The neighbour that must NOT be "fixed" the same way

`setWorkoutSessionWarmupEnd` also matches zero rows sometimes, and there that is **correct**: it
carries `isNull(warmupEndedAt)`, so zero rows means "already set". The question to ask of any
user-scoped UPDATE is whether zero rows is an expected idempotent outcome or an error — and there is
now a test pinning the warmup case as silent, beside the RPE case as an error, so the distinction is
visible in one place rather than argued.

## Verification

- **10 DB-backed tests**: the adapter reporting true/false for owner, cross-account and fabricated
  id (and the cross-account row staying untouched, so the security half stays pinned); the route's
  200 / 404 / 404; the push counting a real write, refusing a matched-nothing one **and naming it in
  `errors`**, and — the one that matters for the outbox — **not stranding a valid sibling behind an
  orphaned one**; plus the warmup-end idempotence guard.
- **Mutation-checked**: reverting both halves turns **6 of the 10** red.
- **Live on `pnpm dev`**: owner → `200 {"success":true}` with `session_rpe = 8` stored; fabricated id
  → `404 {"error":"Workout session not found"}`, where it used to report success.
- Full suite **494 files / 4,024 tests passed** · `tsc --noEmit` clean.

## Failure surfaces NOT exercised

- **Not device-verified.** The outbox half is proven through `pushMutations` against a real database,
  but not through the APK's local store — `getLocalStore` returns null in the sandbox. The entry
  noted the same limitation when it was filed.
- **The retry/dead-letter path itself is not run here** — the test asserts the mutation reaches
  `errors`, and the client's backoff behaviour on that is existing, separately-tested code.
- No device, no Kotlin, no APK.

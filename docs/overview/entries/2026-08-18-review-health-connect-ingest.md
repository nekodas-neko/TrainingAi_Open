# 2026-08-18 — Review sweep 30: the secret-gated ingest route, driven for real

**Agent:** Review 📖 · **Branch:** `review/health-connect-ingest` · **Docs-only.** Filed Q-493…Q-496.

`app/api/health-connect/ingest/route.ts` is the only unauthenticated write into `body_metrics`, and
it has sat on this role's baton as an untested surface since sweep 1 — every earlier sweep read it
and moved on, because exercising it needs `HEALTH_CONNECT_INGEST_SECRET` set. This sweep set the
secret locally and drove it. All four findings are reproduced against a running server.

**Q-493 (high) — the SEC-I3 brute-force gate is bypassed by rotating one request header.** Every
limiter in the codebase keys on `x-forwarded-for`'s **leftmost** hop, which is the value the *client*
supplies. Thirty wrong-secret attempts each way, limit 20/60 s: both sets return 401 throughout by
design, so the observable is the `rate_limits` table — **fixed** header produced 1 key at count 20
(gate engaged, 10 blocked); **rotating** produced **30 keys at count 1, every one reaching the secret
compare.** Seven sites share the pattern, including `admin/day-review`, the bearer path to the
owner's full health history. Nothing in the docs records this, and the R1 security-hardening plan
*propagated* it — the `status` route was added keyed this way "matching the existing pattern".

**Unverified, and stated as such:** whether Railway's edge proxy sanitises the header before the app
sees it. Not determinable from the sandbox, and production's limiter was not probed unasked. The
code-level bypass is proven; production exploitability turns on that unknown. The fix does not
depend on the answer.

**Q-494 (high) — one far-future date permanently captures every "most recent" read.** The regex
bounds the date's shape; nothing bounds its range. `POST {"date":"9999/12/30","weightKg":499}` took
`getMostRecentConfirmedWeightKg` from **81 kg to 499 kg**, and no later write can outrank it. It
feeds the BLE-scale confirmation path and `deriveActivityKcal`. The ranked source merge cannot help
and the reason is worth keeping: ranking is per column **per date**, so a row on a date nothing else
ever writes has no competitor and rank 1 wins outright — the protection is orthogonal to this
attack, not weak against it.

**Followed up, and it sharpened Q-494 considerably.** This is not a novel class — it is the one
ingest path that never got the fix its siblings have. `packages/shared/src/validation/ingest-clock.ts`
exists for exactly this and guards `scale-ble/samples`; `oura-ble/samples` is guarded downstream by
`step-day-buckets.ts`, which says it is making *"the same judgement `resolveMeasuredAt` already makes
on the scale ingest path"*; and the workout path got `resolveCompletedAt` at **Q-24 §7**, whose
comment says `completedAtMs` *"was accepted unbounded and uncompared"* — the same sentence that
describes `date` here. `health-connect/ingest` has no clock bound anywhere in its chain. The
sibling-surface rule was missed twice. That also fixes the shape of the remedy: route the date
through the existing module rather than adding a bespoke range check.

**The wider lens closed on the finding already filed.** Ten `desc(...).limit(1)` "latest X" readers
exist; the other nine read server-derived or device-monotonic columns, and `workoutSessions.completedAt`
— the one that *was* exposed — is now guarded. `bodyMetrics.date` is the only unguarded one.

**Q-496 (medium)** — `2026-13-45`, `2026-02-31`, `0000-00-00` pass the shape regex and return HTTP
500 plus an `error_events` row each. That is the class `normalizeDateParam` exists to prevent, and
this route never got the guard; it makes the fault table every session must read less trustworthy.

**Q-495 (low)** — `z.coerce.number()` turns `[]`→0, `true`→1, `""`→0 kg. The route's comment claims
the bounds reject garbage and names two examples; **both named examples are correctly rejected** —
the three that slip through are the ones it does not name.

**Stated first in the write-up, because three of four findings are refinements of it:** the gate runs
*before* the compare and returns an identical 401 on trip, `safeCompare` is constant-time and
length-safe, the date regex accepts both separators (the Q-130 lesson), and writes are stamped at the
lowest source rank.

**Not exercised:** local dev server against the seeded DB — not on device, not against production,
not against Railway's real proxy. All rows this sweep created in `body_metrics`, `error_events` and
`rate_limits` were deleted, and the 81 kg reading was verified restored afterwards.

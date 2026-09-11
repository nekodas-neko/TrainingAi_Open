# RV-40 — the malformed-id guard had never been pointed at a body

**Branch:** `lane-a/rv40-malformed-id-body-params` · **Lane A** · no migration, no native change.

`invalidUuidResponse` exists because Q-482 measured 21 route/method pairs answering 5xx on
`not-a-uuid`. Its own comment calls it *"the guard every dynamic `[id]` route runs"* — and that is
exactly the population it got. An id arriving in a request **body** is the same hazard and was never
swept.

Two routes still 500'd on one, both with **`Content-Length: 0`**. Re-measured live before touching
anything, and all three of the entry's consequences reproduced:

1. A zero-byte 500 makes `res.json()` throw a parse exception on top of the real fault — the
   rationale RV-33 gave for the ownership half of the very same file.
2. The malformed id reached the driver as a 22P02, so the failing statement — raw SQL, table and
   column names included — was filed into `error_events` as a server fault. My probes wrote 2 rows;
   the same probes now write **0**.
3. A client input error, answered as a server fault, in the channel every session reads first.

## Three corrections to the entry

**The population figure was stale.** The entry said *"27 route files use it, 27 of 27 are dynamic
`[id]` routes, zero take the id from a body."* Measured 2026-09-11: **35 files, 5 of them not
dynamic.** RV-47 swept three body-id routes in the interim — `admin/exercises`, `admin/users`,
`workout-entry` — with the same reasoning. The class was half-closed before this entry was opened.

**The broken verb was wrong.** The entry names `POST /api/progression-styles`. POST answers a clean
`400 Invalid style` — its Zod catches the malformed id. The 500 is on **DELETE**, which hand-parses
its body.

**The two "unverified" rows are settled, and both are clean.** `POST /api/complete-workout` and
`POST /api/log-exercise` each answer 400 JSON; their schemas reject the payload before an id reaches
the driver.

## The sweep

All eight of the entry's candidates are now accounted for, and I carried on past them through every
other hand-parsed-body route — `phase-sets`, `admin/activity-types`, `admin/invites`, `friends`,
`water-log`, `oura/workouts`, `user/equipped-title`. **No further 5xx.** Two routes were broken; both
are fixed.

## The guard is conditional on purpose

`DELETE /api/progression-styles` accepts **either** an id or a name, so the check is
`if (body.id && badId)`. Guarding unconditionally would make delete-by-name answer "Invalid id" to
every request — which is precisely the BF-53 regression, where a uuid guard applied to two
integer-keyed routes broke every real call instead of none. That mutant is in the pass below.

## Verification

5 tests. Mutation pass: each guard removed separately, plus the conditional made unconditional —
**three mutants, all killed**; a whitespace-only control survived.

Live, after the fix: both routes answer `400 {"error":"Invalid id"}` on a malformed body id,
well-formed ids still return 200, delete-by-name still works, and `error_events` gains nothing.

## Not exercised

No device path and no APK — server route guards.

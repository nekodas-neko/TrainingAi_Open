# Review Agent 📖 — baton

> **Successor sessions are titled `Review Agent 📖`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-18 · **By:** twenty-four sweeps (2026-08-17 ×2, 2026-08-18 ×22) — **all eleven pillars covered** · **Q band:** 450–499 (next free: **489**)

## Now

Twenty-four sweeps have run under this role. **Every one of the eleven pillars has now been reviewed at
least once**, at the owner's request to work through the sections:

| Pillar | Lens applied | Findings |
|---|---|---|
| `workouts` | write path cross-user + live drive, **AI double-trips**, **write concurrency** | Q-460…Q-462, Q-470, **Q-473, Q-474** |
| `nutrition` · `cardio` · `activity` | writes cross-user + app-wide not-found probe | Q-463 |
| `sleep` · `readiness` · `heart-rate` · `body` · `devices` | ingest auth, value validation, schema strictness | Q-464, Q-465 |
| `app-shell` · `platform` | failure cells, repo-migration architecture, **the Coach write path** | Q-450…Q-459, Q-467, Q-468 |

**Sweep 11 closed the non-default-timezone gap** — a user was moved to `Pacific/Kiritimati` and the app driven as them. **Sweep 10 closed the offline/error-path gap on its server half** — `/api/sync/push` was pushed for real, including with the database stopped. What is still untested there is the **on-device** half (the local SQLite outbox itself, which the web sandbox cannot open).

**Still open by design, and the obvious next lenses:** the **device runtime** (nothing in any sweep
left the web build — every offline-first domain took its web fallback), **production data** (now used — sweeps 7 and 8; the
remaining gap is a *second account*, since `claude_ro` sees only the owner), the **offline and error paths** (everything ran
against a healthy server on a live network), and the secret-gated `health-connect/ingest` validation.

### Sweep 24 — is Q-488 the only one? (2026-08-18)

**Filed nothing; bounded Q-488.** Write-up:
[`docs/reviews/2026-08-18-local-first-write-coverage.md`](../../reviews/2026-08-18-local-first-write-coverage.md).

**Q-488 is the sole instance — its fix is one handler, not a class sweep.** All eight other
delete/patch handlers on local-first domains write to the store inside the handler. That is the
question an implementer has to answer before budgeting the work, so it was amended onto the entry
rather than filed separately.

**⚠️ The obvious version of this check is unsound and its own output proves it.** Asking whether the
*file* touches the local store clears `health-content.tsx` — the Q-488 file — because it uses the
store elsewhere. **File-level coverage says nothing about a handler**; audit the handler window.

**⚠️ "No pull mapping" is not evidence of a gap.** `meal-plan-setup-sheet.tsx` creates saved meals
server-only and is **fine**: `saved_meals` is **push-only** in the outbox and kept fresh by
**hydrate-on-read** (`saved-meals-sheet.tsx:111` hydrates; `food-logger-sheet.tsx:196` falls back to
the API). A future audit testing pull coverage alone would file it wrongly.

**Pattern across sweeps 21–24:** four consecutive sweeps in the staleness family, and in every one the
*mechanical* test was wrong in a different way — over-reporting seed-only keys, clearing a file that
contains the bug, treating hydrate-on-read as absent. **In this codebase, freshness is maintained by
at least four mechanisms and no single grep sees them all.** Read the handler.

### Sweep 23 — a write that updates the server but not the local store (2026-08-18)

**Took the successor sweep 22 named for itself, and it found something.** Write-up:
[`docs/reviews/2026-08-18-server-only-writes-to-local-first-domains.md`](../../reviews/2026-08-18-server-only-writes-to-local-first-domains.md).

**Filed Q-488 (mid).** The activity delete (`health-content.tsx:684-700`) updates the server and the
caches and **never the local store**. Three surfaces read `activity_logs` local-first, and `pullDelta`
is throttled to **5 minutes** un-forced with nothing in the delete path forcing one. **It self-heals**
via the soft-delete tombstone and `applyDelta`'s `sync_status='synced'` guard — visible
inconsistency, not data loss, and the entry says so up front.

**Why it survived, and the reusable part:** the originating screen is **correct**. It reads
`day-log:<date>` from the server (a sanctioned cross-domain aggregate), so the activity vanishes
*there* immediately and nothing on that screen could reveal it. **A server-reading screen writing to a
local-first domain is a blind spot by construction** — that is where to look next in this class.

**The rule is not written down and should be.** `CLAUDE.md` has the forward direction only. The
inverse: *a domain the UI reads local-first must have **every** write update the local store —
including deletes, and including writes from a screen that itself reads server-side.*

**⚠️ Not reproduced** — `getLocalStore` returns null on web, so the local-first readers fall through to
their API fallbacks and the inconsistency cannot appear in this harness. Second source-read-only
finding of the run, labelled as such everywhere.

### Sweep 22 — case (b), seed-only read paths; the lens is now closed (2026-08-18)

**Filed nothing. Both halves of Q-262's staleness test are now audited and clean.** Write-up:
[`docs/reviews/2026-08-18-seed-only-read-paths.md`](../../reviews/2026-08-18-seed-only-read-paths.md).

**⚠️ The mechanical test over-reports — do not use it.** `readCacheSync` keys minus `cachedFetch` keys
(51 vs 66) gives five "seed-only" candidates; **all five revalidate.** Revalidation happens **three**
ways and `cachedFetch` is only one: (1) `cachedFetch`, (2) a raw `fetch` + `setCached`, (3) a
**local-store read** + `setCached`. **The third is the trap** — for an offline-first domain the local
store *is* the source of truth, so a network-shaped test marks the app's most authoritative paths
stale. The real test is "no write-back to the key from any source after the seed", which is not
greppable; read each candidate.

**⚠️ A `Q-NNN:` comment in this codebase is usually a fix's rationale, not an open defect.** That cost
a false alarm **twice** this run — Q-117 (`session-select-content.tsx:896`, "never invalidated … up to
6 hours") and Q-126 (`workout-screen.tsx:272`, "reported the user's entire lifetime XP"). Both read
exactly like live bug reports; the fix is the line below. Check before reaching for the alarm.

**Where this lens goes next:** not further into Q-262's test, which is exhausted. A stale-value bug
arising some *other* way — a write that updates the DB without touching the local store — is outside
what that test catches and has never been looked for.

### Sweep 21 — which cache invalidations are actually load-bearing (2026-08-18)

**Filed nothing; closed an audit `CLAUDE.md` names as never done.** Write-up:
[`docs/reviews/2026-08-18-load-bearing-cache-audit.md`](../../reviews/2026-08-18-load-bearing-cache-audit.md).

Q-262's test: a stale entry survives as a *settled* value only via **(a)** `freshWithinTtl: true` or
**(b)** a seed-only read path. `CLAUDE.md` recorded that only `invalidateGoalRecommendations` was ever
checked. **Case (a) is now audited: 16 occurrences → 7 keys, all `TTL_LONG`, all in a group, and every
client writer calls its group. No gap.**

**Two things worth carrying:**
1. **`session-select-content.tsx:896`'s "never invalidated … for up to 6 hours" is the comment on the
   Q-117 FIX**, not a live defect — `invalidatePrescriptionChanged()` is the next line. It reads
   exactly like an open bug; I reached for the alarm before reading on.
2. **Case (b) — seed-only read paths — is still unaudited**, and it is the likelier source of a
   stale-value report because it leaves no revalidation at all. **That is the next sweep in this lens.**

**Recorded, deliberately not filed:** the invalidations are **device-local**, so a shared table
(`exercise_library`, `activity_types`) stays stale ≤6 h on every *other* client. `TTL_LONG` is
documented as "slow-changing config" and there is no second writer today — but when multi-user lands
the answer is a version/etag or a shorter shared-config TTL, **not** more invalidation call sites,
which cannot cross devices.

### Sweep 20 — this run's fourteen findings, checked against production (2026-08-18)

**Filed nothing; amended six entries.** Sweep 8 did this and corrected four findings; fourteen more had
accumulated unchecked. Write-up:
[`docs/reviews/2026-08-18-production-verification-round-2.md`](../../reviews/2026-08-18-production-verification-round-2.md).

**⚠️ Q-475 shipped mid-sweep (#115) and the fix covers only half of what the evidence shows.** The
classification (`isRetryableWriteError`), the client no longer counting a retryable failure against
`MAX_MUTATION_ATTEMPTS`, and the whole-queue backoff are all genuinely fixed. **`reportServerError`
is still only in the route's outer catch**, which `pushMutations` never reaches — so a push failure
still never reaches `error_events`. **Filed Q-487** for that half; the Q-475 entry was removed from
the queue (completed on main).

**The production shape is an absence, and it is the evidence for Q-487.** `/api/sync/pull` has **69** faults in
`error_events` (2026-07-19 → 2026-08-13); `/api/sync/push` has **zero, ever** — across six days with
**125** database connection failures (39 in one day). `sync-provider.tsx` runs `await
pushMutations()` at :139 and `pullDelta` at :145, **push first, same cycle**, so the zero is not
absent traffic — it is **push cannot report**. The table designed to catch invisible faults has a
blind spot exactly where that finding lives.

**Q-482/Q-483 never triggered** (zero `22P02` ever) — filed low, and should stay there.
**Q-484 latent confirmed** — `injuries` is empty. **Q-481 and Q-485 unprovable from production**, and
Q-485's obvious query (35/114 rows with steps and no weight) is **the expected shape**, not evidence —
same trap as Q-460's "74% lack an RPE".

**Two concurrency lessons from this sweep, both cost real work:**
1. **Check whether a finding shipped before writing about it as open.** Q-475 was implemented while
   this sweep was measuring it. The measurement was still worth having — it showed the fix's blind
   spot — but the row had to be rewritten and the queue entry removed.
2. **Check whether a chore already landed before doing it.** I ran the entries compaction and folded
   19 unlinked entries; `#130` had folded the same 19 an hour earlier. The whole fold was discarded.
   `git log origin/main --oneline -- <path>` first.

**Make this a habit, not a one-off.** Two rounds have now run and both changed how findings should be
read — sweep 8 corrected four, this one upgraded one and stopped four from being over-priced. **Run it
before a run's findings are handed to an implementer, not after.** And write the amendment into the
entry itself: `error_events` prunes at 30 days, so the pull-69/push-0 asymmetry cannot be re-derived
later.

### Sweep 19 — the last line of defence for a workout, failing silently (2026-08-18)

**Followed sweep 18's named pattern to its worst case: a write that fails and reports success.**
Write-up: [`docs/reviews/2026-08-18-tier-a-enqueue-silence.md`](../../reviews/2026-08-18-tier-a-enqueue-silence.md).

**Filed Q-486 (mid).** Four `queueMutation` calls swallow — `workout-screen.tsx:1320,1324`
(`workout_log`) and `:1527,1532` (`complete_workout`) — and they are the **only four in the app**, all
**Tier-A**. `queueMutation` is a bare `runSQL` INSERT, so it throws whenever the local DB is dead,
which `CLAUDE.md` records happening **twice** on Android. To lose a set, the POST must fail (offline)
*and* the store be broken; then nothing is sent, queued, logged, or recoverable — and the haptic has
already fired.

**I nearly mis-sized this.** The surrounding design is good: local write first (its failure *is*
logged), a direct POST as primary explicitly *"independent of the outbox … (which can fail
silently)"*, outbox as fallback. **26 of ~30** other `queueMutation` sites correctly `await`. Read the
layering before judging the hole — the entry leads with that.

**Three "do not"s in the entry:** do not undo the layering, do not convert the four to `await` (they
are fire-and-forget so the UI stays instant), do not treat it as reproduced.

**⚠️ Cannot be reproduced in this harness at all** — `getLocalStore` returns null on web, so
`store_?.` short-circuits and the code path never runs. This is the first finding of the run that is
**source-read only**, and it is labelled as such everywhere it appears. On-device is the only real
verification.

### Sweep 18 — an implausible value down both write paths (2026-08-18)

**Filed Q-485 (mid-low).** `CLAUDE.md` says sync-push must mirror the web route and the push branch's
comment claims it does; nobody had sent the same out-of-range value down both. Write-up:
[`docs/reviews/2026-08-18-implausible-value-silent-drop.md`](../../reviews/2026-08-18-implausible-value-silent-drop.md).

`weightKg: 10000` (bound 500): web → **400** with a clear message; sync push → **200**
`{"processed":1,"errors":[]}`, row written with `weight_kg` NULL. **Invisible in all three places it
could be recorded** — `errors: []`, no `console.*`, no `error_events` row (verified by query).

**The bounds are correct and must not be touched** — both paths share one validation module, which is
`One Formula, One Place` holding. Only the *behaviour* differs, and the same function already has the
visible version: **12 of 14** value checks coerce silently, **2** throw (`waterMlDelta`,
`sleep_session`) and reach the dead-letter badge. Weight is in the silent group.

**⚠️ The fix is NOT "throw everywhere"** — a throw quarantines the mutation and the poison-pill rule
forbids that for a validation failure. Recommended order in the entry: log it server-side (one line),
then a `warnings[]` channel separate from `errors[]`, then a per-field product call an implementer
should not make in passing.

**Pattern worth naming for successors:** three of the last four sweeps found the *bounds/logic*
correct and the *reporting* wrong (Q-475 a DB outage as HTTP 200, Q-476 a schema drop as success,
Q-485 a coerced field as success). This app validates well and tells you badly. That is a productive
place to keep looking.

### Sweep 17 — the create routes nobody gave a schema (2026-08-18)

**Filed Q-484 (mid-low).** `CLAUDE.md` says oversized input is *"a rejection, not a skip"*; nothing
had tested it. Write-up:
[`docs/reviews/2026-08-18-unvalidated-create-bodies.md`](../../reviews/2026-08-18-unvalidated-create-bodies.md).

`POST /api/injuries` accepted a **10 MB** `notes` and stored all 10,000,000 characters (201). A 700 kB
body across `muscleName`+`notes` likewise; `POST /api/supplements` the same. **The asymmetry is the
finding:** `PATCH /api/injuries/[id]` runs `InjuryPatchSchema` (`max(100)`, `max(1000)`, a date regex)
— the very schema `CLAUDE.md` cites as **the reference** for whitelisting — while the POST beside it
destructures a raw body. The unvalidated `startedDate` also 500s, the Q-482 class with the same root.

**Two caveats that are the reason the entry is safe to act on, both carried inline:**
1. **10 MB is NOT a storage number.** `pg_column_size` read ~120 kB — TOAST compresses a single
   repeated character almost perfectly. Real text would not. Defensible claims: transfer/parse cost is
   unbounded; stored size depends on compressibility.
2. **33 no-schema routes is a CANDIDATE count, not a defect count.** Several do hand-rolled checks,
   several are admin-gated; only **2** were probed. Do not treat the other 31 as broken *or* as fine.

**Nearly reported a meaningless ratio.** 163 `z.string()` declarations vs 31 with `.max()` under
`app/api` — but most unbounded ones are **AI output schemas** (`generateObject` response shapes), not
request bodies. Separate the two before quoting any such count. Same family as the sweep-15
`JSON.stringify` mistake: a number that looks like a measurement and is not.

### Sweep 16 — an id that is not a UUID (2026-08-18)

**The third id case**, after another user's (protection holds) and valid-but-missing (Q-463). All 30
dynamic route files, every method, twice — control UUID vs `not-a-uuid`, 39 pairs. Write-up:
[`docs/reviews/2026-08-18-malformed-route-ids.md`](../../reviews/2026-08-18-malformed-route-ids.md).

- **Q-483 (upper-mid)** — `GET /api/workout-sessions/not-a-uuid/recap` returns **500 with the full
  SQL** and every column name of `workout_sessions`, from the route's **own** catch
  (`error: errorLog(...)`). `errorLog` has **no environment gate**, so this ships in production. Three
  routes leak, a fourth carries the pattern guarded upstream. Authenticated-only disclosure, and the
  fix is free — `reportServerError` already ran on the line above.
- **Q-482 (mid)** — 21 new route/method pairs across 14 routes 500 on a malformed id (Postgres
  `22P02`), while answering a valid-but-missing one correctly. **Only 2 of 30 dynamic routes validate
  the id at all.** Fix: a shared `parseUuidParam`, the `normalizeDateParam` precedent, plus a ratchet.

**⚠️ Evidence-reading rule, in both entries:** a **500 is conclusive**; a **400 is not**, because the
probe sent `{}` and a body-bearing method may fail its body schema before the id is used. Routes
absent from the table are verified-correct only if GET or DELETE. Without that caveat the table reads
as an all-clear for everything it omits.

**Harness note:** the dev server died mid-probe and every request returned `HTTP 000`. That is not a
finding about the app — check the server is alive before believing a run of zeros.

### Sweep 15 — the empty account, the n=1 account, and a probe that could not have worked (2026-08-18)

**Filed nothing.** All **126** static GET routes driven twice — zero rows in every domain, then
exactly one `body_metrics` and one `sleep_sessions` row. Write-up:
[`docs/reviews/2026-08-18-empty-and-single-datapoint-accounts.md`](../../reviews/2026-08-18-empty-and-single-datapoint-accounts.md).

**⚠️ The method correction is the deliverable, and it is the most reusable thing this run produced.**
The probe grepped response bodies for `NaN`/`Infinity`, came back clean **twice**, and could not have
detected either: `JSON.stringify({x: NaN})` → `{"x":null}`, same for `±Infinity`. Both serialise to
`null`, indistinguishable from a legitimate no-data null. **Never run a numeric-corruption check
against a serialised JSON body** — audit the divisions, or use a differential (numeric at n=many,
`null` at n=1 while its input exists).

**By the correct method: no unguarded division** anywhere in `app/api`, `packages/shared/src` or
`lib/health`. The four that look unguarded from a grep each carry an explicit early return
immediately above. **No route changed behaviour between zero data and one data point.**

**Three 5xx, all environmental, none filed** — `download-apk` (no GitHub from the sandbox),
`push/subscribe` (VAPID unset), and `oura-ble/decoder-constants` (bodiless 500; the vendored constants
are deliberately out of the public repo). The last is not filed on purpose: the client's `isUsable()`
exists to reject an error-shaped payload and the decoder throws on an absent table, so the failure is
loud where it matters. **`onRequestError` verified working** — it wrote the `error_events` row for
that bodiless 500, confirmed by querying the table.

**Three harness artifacts caught in this run now** (backgrounded-`sleep` false stall, wrong-column
false negative, discarded cookie, and this). Every one produced a *clean-looking* result. The habit
that catches them: before recording a clean result, ask what the probe would have done if the bug
were present.

### Sweep 14 — the same mutation pushed twice (2026-08-18)

**The gap between sweeps 9 and 10** — concurrent writes measured, outbox-under-failure measured, but
never the same mutation arriving **twice in sequence**, which at-least-once delivery guarantees.
Write-up: [`docs/reviews/2026-08-18-outbox-replay-idempotency.md`](../../reviews/2026-08-18-outbox-replay-idempotency.md).

**Filed Q-481 (mid).** Same mutation id ×3 → `water_ml = 750` for 250 logged, every push answering
`{"processed":1,"errors":[]}`. The server keeps **no record of processed mutation ids**, and the
client's `try { await fetch(…) } catch { break }` leaves a committed-but-unacknowledged mutation
`pending` with nothing marking it in-flight. **`waterMlDelta` is the only non-idempotent branch of the
19** — every other domain upserts on `(user_id, date)` or a client-supplied row id.

**The entry leads with what NOT to do:** the additive write is deliberate (SYNC-P7 — concurrent adds
must sum, not clobber), so the fix is mutation-id dedupe for that one branch, never an absolute total.
That is the way this gets implemented wrongly.

**Three clean results**, one load-bearing: `complete_workout` replayed 3× → counter = **1**, a second
independent confirmation of the **Q-473** fix covering the *replay* vector its comment named (sweep 9
covered the concurrent one). And `activity_logs` replayed 3× gives **one** row — which looks like it
contradicts sweep 9's "5 concurrent → 5 rows" and does not: **different writers**, web route vs
outbox. Worth remembering before reasoning about one path from the other.

### Sweep 13 — verifying the server side; a clean sweep, written up as one (2026-08-18)

**Went looking for the server half of Q-477 and it is not there.** Write-up:
[`docs/reviews/2026-08-18-server-tz-and-rate-limit-verification.md`](../../reviews/2026-08-18-server-tz-and-rate-limit-verification.md).

Sweep 11 based "the server is correct" on counting `todayInTz()` **inside route files** — not the
whole server, since a blameless route still gets Brisbane if the repo function it calls defaults the
tz. Checked and clean: every caller of the tz-defaulting repository helpers threads the session tz;
all **4** timezone-sensitive SQL sites in `lib/data` are parameterised (no hardcoded zone string
anywhere in the repository layer); every call site of the shared sleep helpers (`nightSessions`,
`sleepScoreBaselines`, …) passes `tz`; zero local `DEFAULT_TZ` re-declarations. **This bounds Q-477 to
the client.**

Rate limiting swept in the same pass: all **13** AI routes limited, all **104** `rateLimit` keys
user- or IP-scoped, **zero global keys**.

**Filed Q-480 (low) — a documentation correction.** `CLAUDE.md` calls the repo day-window helpers
timezone-*hardcoded*; they take a **default parameter** every caller overrides. The stale line marks
`lib/data` as known-broken, so whoever takes Q-477 starts there and finds nothing. **Filed rather than
edited directly** — `CLAUDE.md` is the contract all five agents read, and a Review agent quietly
rewriting a rule line is a change the other four should see come through the queue.

**Worth carrying: a clean sweep is a result.** It is written up at length on purpose — the inventory
of what was checked is the deliverable, so sweep 14 does not re-derive it. Do not manufacture a
finding to justify a sweep; do record what was ruled out.

### Sweep 12 — does revoking access actually revoke it? (2026-08-18)

**The first sweep to test privilege *revocation* rather than cross-user data isolation.** Write-up:
[`docs/reviews/2026-08-18-auth-session-boundaries.md`](../../reviews/2026-08-18-auth-session-boundaries.md).

**Filed Q-479 (mid).** `lib/admin.ts` holds two admin checks that disagree: `requireAdmin` ignores the
passed flag and reads the row (**61 routes**, revocation immediate); `isAdminUser` returns the flag
when given one. Seven of its ten call sites pass the JWT claim — six are page guards (UI, correct),
the seventh is **`app/api/exercises/route.ts:38`**, an API write into the shared `exercise_library`.
The claim refreshes only once per 24 h (`ISACTIVE_RECHECK_MS`), and the module's docstring asserts it
*"governs the UI only"* — which is false, and is why this was easy to miss.

**Measured with a control:** admin revoked in the DB, no re-login → `POST /api/exercises` **201**
(row created) while `GET /api/admin/errors` **403**, same cookie, same instant.

**Five clean results**, including the one worth reusing: `/api/health-connect/ingest` is the
**reference fail-closed implementation** — 401 with the secret unset *and* on an empty secret, IP
limiter before the constant-time compare, identical 401 body on trip.

**⚠️ The method note is worth more than the finding, and belongs in every future harness:** the first
run reported revocation **working** and was wrong. `curl -b` without `-c` discards the rotated
cookie, so every request re-sent a token with no `isActiveCheckedAt`, the throttle never engaged, and
the DB was re-read every time. **A session-staleness test is meaningless unless the client persists
cookie rotation** — use `-b` and `-c` on the same file. This is the third harness artifact this run
(after the backgrounded-`sleep` false stall and the wrong-column false negative in sweep 9); the
pattern is that a *clean* result deserves as much suspicion as a dirty one.

### Fix verification — Q-473 confirmed fixed by re-running the reproduction (2026-08-18)

**#112 landed the Q-473 fix the same day, taking the option this role recommended** —
`completeWorkoutSession` returns its affected-row count and the caller decides from the write.
Review re-ran the original reproduction on the merged code: four fresh trials, four concurrent
completes each, **`sessions_in_phase` = 1, 1, 1, 1** (was 3, 3, 2, 1). Confirmed fixed; the
`projectOverview.md` row was amended from 🔴 to 🟠 rather than archived, because **Q-474 is still
open**.

**Worth making a habit.** Verifying an implementer's fix costs one re-run when the reproduction is
already written down, and it is the only thing that distinguishes "shipped" from "fixed" — a
distinction `CLAUDE.md` cares about enough to have a rule for. Keep reproductions in the review doc
in a form that can be replayed.

### Sweep 11 — the app run as a user who is not in Brisbane (2026-08-18)

**The blind spot `CLAUDE.md` names, entered for the first time** — all 30 local user rows are
`Australia/Brisbane`, and no sweep had ever left the default zone. Write-up:
[`docs/reviews/2026-08-18-timezone-non-default-user.md`](../../reviews/2026-08-18-timezone-non-default-user.md).

**Filed Q-477 and Q-478 — both placed BELOW Q-473/Q-475**, deliberately: those two affect the current
user today, these are latent (no user has a non-Brisbane zone).

- **The server is clean.** Zero argument-less `todayInTz()` in `app/api/**`. Live: `day-checkin` →
  `logDate: 2026-08-19`, `workout-data` → `dataDate: 2026-08-19`. Both correct. Every finding is
  client-side.
- **Q-477 — the setting is what breaks it.** On Brisbane, client and server agree. Setting the zone
  moves the server and not the client's **91** argument-less `todayInTz()` calls (vs 25 correct, plus
  **9** `localDateString()` reading the *device's* zone — three answers, not the two `CLAUDE.md`
  warns of). `edit-profile-sheet.tsx:190` ships an **"Auto-detect timezone"** button, so the intended
  one-tap action for a non-Brisbane user is the one that desynchronises them. **Seen on screen:** the
  Health calendar highlighted **18** on a day that was the 19th for that user.
- **Q-478 — the cheap half, do it first.** `isWorkoutDataToday`/`isBodyMetadataFresh` compare a
  server-stamped date to a client `DEFAULT_TZ` date → false for |Δoffset| hours a day (**14 h/day for
  New York**). Real UI states: session-select's early return leaves `setMetaLoading(false)` unrun.

**Method notes that will otherwise cost the next session an hour:**
1. **Changing `users.timezone` is not enough** — it is stamped into the JWT at login, so re-login
   before testing. A stale cookie makes the whole thing silently pass.
2. **Run it only when the zones disagree by a calendar date** — check `TZ=<zone> date +%F` against
   `TZ=Australia/Brisbane date +%F` first. An hour-only offset hides every symptom.
3. **`pnpm install` after pulling `main`** before `pnpm dev` — a newly-added dep (`qrcode`) produced a
   Turbopack "Module not found" that reads like a repo break and is a stale `node_modules`.

**Remaining timezone work this sweep did NOT cover:** the repo-layer day-window helpers that
`CLAUDE.md` says hardcode `DEFAULT_TZ`, and anything on the APK (the 9 `localDateString()` sites read
the *phone's* zone there — a third value this harness cannot reproduce).

### Sweep 10 — the outbox under failure, with the database actually stopped (2026-08-18)

**The first sweep to post a batch at `/api/sync/push` at all.** Write-up:
[`docs/reviews/2026-08-18-outbox-under-failure.md`](../../reviews/2026-08-18-outbox-under-failure.md).

**The poison-pill rule holds and that is worth leading with.** Five mutations, poison third, four
siblings behind it → `processed: 4`, error keyed by outbox **id**, all four sibling rows written. The
rule `CLAUDE.md` says cost three production incidents is genuinely enforced at both layers.

**Filed Q-475 (high) and Q-476 (low-mid).**

- **Q-475 — a DB outage arrives as HTTP 200.** Stopped Postgres → `{"processed":0,"errors":[…]}` with
  **200**, because `pushMutations` catches per-mutation (the same property that makes the poison-pill
  rule work). The client resets `consecutive5xx` instead of engaging backoff, keeps hammering, and
  bumps `attempts` on every mutation: 30 s → 2 m → 8 m → 32 m, so **≈42.5 min of outage dead-letters
  the whole outbox**. Not data loss — rows kept, badge, toast — but the retry UI is **per-item only**.
  Same class as **Q-548**, filed the same day by another lane.
- **Q-476 — the worse failure gets the softer handling.** A schema-rejected mutation returns
  `errors: []`, which the client reads as success, so the row is **deleted** silently; an in-handler
  failure is kept, badged and retryable. `pushMutations`' `Unsupported domain` branch argues against
  exactly this and is unreachable behind the route's `z.enum`. **Latent, not live** — all 36
  `queueMutation` call sites produce a safe date today.

**Method note worth keeping: stopping the local cluster is cheap, safe and reversible**
(`pg_ctl -D /var/lib/postgresql/local-dev -m fast stop`, then `scripts/local-db/setup.sh`). The two
migration warnings on restart are the normal already-applied lines. This sweep's main finding came
out of it, and no earlier sweep had tried it — error paths are reachable, they just need the harness
broken on purpose.

### Sweep 9 — write concurrency, fired for the first time (2026-08-18)

**The first sweep in this role to send two writes at once and read the row afterwards.** Write-up:
[`docs/reviews/2026-08-18-write-concurrency.md`](../../reviews/2026-08-18-write-concurrency.md).

**Filed Q-473 (high) and Q-474 (low).**

- **Q-473 — `sessions_in_phase` over-increments, measured.** Four concurrent
  `POST /api/complete-workout` for **one** session → four `200`s, `completed_at` on exactly one row,
  counter at **3, 3, 2, 1** across four trials. Reproduced 4 of 5. Check-then-act: the guarded UPDATE
  exists and returns `void`, so the idempotency decision comes from a read taken before it. This is
  the counter `CLAUDE.md` says has drifted three times, in a function whose comment promises it
  cannot. The outbox replay path calls the same function.
- **Q-474 — a naming trap, filed because it nearly buried Q-473.** `workout_sessions` carries two FKs
  to `program_sessions`; `program_session_id` is dead (zero code references, 0 of the owner's 91 prod
  rows) and owns the name the live `session_id` is used under.

**Four clean results recorded** (`day-checkin` idempotent, `completeWorkoutSession`'s UPDATE guarded,
`upsertPersonalRecordIfBetter` correctly locked with `FOR UPDATE`, phase-`transition` idempotent) and
**one deliberately not filed** (`activity-logs` duplicates freely, but every caller holds an in-flight
guard and server-side dedupe would be wrong).

**Two method notes worth more than either finding:**
1. **My first Q-473 run was a false negative and I nearly published it.** The fixture populated the
   dead column, the periodization block silently skipped, and the counter did not move. Rule:
   **populate a fixture through the code path's own writer, or verify which column it reads.**
2. **The rate limiter's L1 is in-memory** (`lib/rate-limit.ts`) — `DELETE FROM rate_limits` does not
   reset it, and six consecutive trials all returned `429`. Space concurrency trials by the full
   window (65 s for a 60 s limit).

**Concurrency is now a lens with a working method, and it is nowhere near exhausted.** Only five
routes were probed. Every other non-idempotent write is unmeasured.

### Sweep 8 — this run's own findings, checked against production (2026-08-18)

**`claude_ro` queried directly for the first time in this run.** Write-up:
[`docs/reviews/2026-08-18-production-verification.md`](../../reviews/2026-08-18-production-verification.md).

**More corrections than discoveries, which is the point.** Filed **Q-472** (the Coach's write
capability has produced **zero** writes — `coach_changes` empty, though 8/8 assistant messages carry
tools and **1** carried a `change_preview`; apply is *not* broken, and why it is zero is not
determinable here). **Amended four of my own entries:**

- **Q-467, Q-468** — real defects, **zero production exposure**; top-of-queue placement was priced on
  exposure that does not exist. Re-scoped, not closed.
- **Q-465 — refuted in practice.** Zero truly-empty check-ins across all 50 rows. ⚠️ **My first query
  said "45 of 50 entirely empty" and was WRONG** — it tested only the seven evening columns and ignored
  six morning ones. Recorded in the entry so the false number cannot be picked up.
- **Q-460 — production cannot adjudicate it.** 74% of completed sessions lack an RPE, which is
  consistent with both a dropped write and a skipped optional prompt; **do not cite it either way.**

**✅ `error_events` read (the session-start ritual, owed and now done).** Nothing unrecorded in 7 or
30 days. The 5,771-hit `[pg 21000]` on `hr-ingest` that dominates the table is **already recorded and
fixed** — I checked before filing, and a duplicate for the loudest line would have been the easy
mistake.

**Method note for the next session: `claude_ro` is row-scoped to ONE user and prunes at 30 days.**
Every count is *the owner's, recently*. A zero means the owner never did the thing — never "no user
did". And check a table's full column list before writing an "is empty" predicate.

### Sweep 7 — the AI-usage screen's double-trips, from owner screenshots (2026-08-18)

**The first production-data finding of this run.** The owner supplied three screenshots of More →
Developer → AI usage. Write-up:
[`docs/reviews/2026-08-18-ai-double-trips.md`](../../reviews/2026-08-18-ai-double-trips.md).

**Filed — Q-469, Q-470, Q-471** (Q-471 placed above the other two, because it decides how they read).

**The lesson worth carrying: check what a metric fingerprints on before believing it.** The screen
showed 89/268 calls (33%) redundant, topped by `meal-plan-generate-meal` at 32·4. Redundancy is
`(user_id, section, fingerprint)` within 120 s — and three sections fingerprint on a **calorie target
alone**, so every deliberate meal reroll counts as redundant. **44 of the 89 are artefact.** The reroll
path is already correctly guarded; an implementer sent there by the screen would find nothing.

The two real ones: `prescription` (14·8) fingerprints on `{programSessionId, today}` and double-fires
because `regeneratePrescriptionInBackground` is fire-and-forget from two sites in `GET
/api/workout-data` with a rate limit but no in-flight guard, while `cachedFetch` always revalidates;
and `running-plan-explain` (31·9) re-asks on every card mount with no cache.

**✅ Corroborations — production confirms two prior entries.** **Q-295 holds exactly** (Coach 6.3% of
calls, 50.7% of tokens). **Q-170's latency fix is holding** — the 30-day Coach average of 5,840 ms
looks like a regression but the 7-day reads **2,307 ms**; **do not reopen Q-170 on the 30-day number**.
Cost is $0.09/30d, so the don't-optimise-spend decision stands.

### Sweep 6 — the AI Coach's write path (2026-08-18) — the first review ever to cover it

Owner picked this from a shortlist of remaining angles. Write-up:
[`docs/reviews/2026-08-18-coach-apply-path.md`](../../reviews/2026-08-18-coach-apply-path.md).

**Why it was the right pick:** the Coach appears in eight prior review docs and five backlog entries,
all about cost/latency/model-ID/navigation. **No review doc mentioned `coach_changes`,
`applyCoachChange` or undo.** It is the only place an LLM-initiated flow writes to the data deciding
what the user is told to lift (five domains).

**Filed — Q-467, Q-468**, both at the top of the queue:

- **Q-467** — the whole undo subsystem is built (route + window guard + five `undo()` handlers +
  `captureBefore` + `undone_at` + history styling for undone changes) and **nothing calls it**. Every
  client Coach fetch was enumerated; the undo path is in none. ⚠️ **Not** the known "no user-facing
  entry point" note — that is phase 1's *apply* path, since wired.
- **Q-468** — `undo` writes `beforeState` back with no drift check, while `apply` has one. Apply A,
  apply B, undo A → the row holds A's "before" while the history still shows B as in effect; undo both
  → the programme ends on a value the user never chose. **Do Q-468 with or before Q-467.**

**CLEAN, and worth protecting:** the apply path is the best-built write path I have read in this repo
— model never in the write path (documented, with why the SDK's binary tool-approval was rejected),
`fieldsMatchDomain` blocking cross-domain field aiming, ownership by join, Zod whitelist quoting
`CLAUDE.md` rule (b), admin gate on shared-catalogue creation, merged-away rows unselectable, no
half-applied patches. **Double-apply refused with a 409 drift report; cross-user undo 404s.**

**Not covered:** only `session_exercise` driven end to end (other four handlers read, not run);
`/api/coach/preview` unprobed; the model was never in the loop, so nothing here says whether it
*proposes* good patches — that is a separate lens.

### Sweep 5 — the ingest surface: sleep, readiness, heart-rate, body, devices (2026-08-18)

Write-up: [`docs/reviews/2026-08-18-ingest-and-input-validation.md`](../../reviews/2026-08-18-ingest-and-input-validation.md).
These five pillars barely expose `[id]` write routes — they are read-and-derive, so the write-surface
lens does not reach them and this one does.

**Filed — Q-464** (70 schema files, only **6** `.strict()`; demonstrated as a silent wrong-day write on
`body-metadata` — **but `sync/push` must not be made strict carelessly**, older-APK payloads may carry
unnamed fields) and **Q-465** (`day-checkin` creates a row from `{}`; **consequence unproven and the
entry says so**).

**CLEAN, and the more useful half:** **no ingest route accepts a `userId` from the body** (all ten
session- or secret-gated, two behind `requireAdmin`), and value validation rejected every
physiologically impossible probe with nothing reaching Postgres — HR `-50`/`99999`, mood `999`/`-5`,
weight `99999`/`-40`, malformed scale hex. The weight errors even name the bound violated.

**Also filed from this run, not from the probe — Q-466:** CI re-downloads the Playwright browser on
every E2E run with no cache; observed stalling **three times on 2026-08-18**, each costing a cancel-and-re-run
on a required check. If E2E sits on `Install Chromium` while `Run pnpm e2e` is still `pending`, that is
the download, not the specs — cancel and re-run rather than diagnosing the specs.

**Not covered:** `health-connect/ingest` was read but **not called** (secret-gated, no secret here), and
the Oura BLE sample routes were not exercised with real frames.

### Sweep 4 — nutrition/cardio/activity writes, and the not-found answer app-wide (2026-08-18)

Owner asked for section-by-section coverage. Write-up:
[`docs/reviews/2026-08-18-write-surface-not-found.md`](../../reviews/2026-08-18-write-surface-not-found.md).

**Filed — Q-463** (sits directly above Q-462, the instance it generalises): the "row does not exist"
answer is inconsistent across 33 dynamic write endpoints, and **five return a 500** (four with an
empty body). One cause — 16 bare `throw new Error('… not found')` in the repository layer with no
route mapping. Matters because a 5xx makes the sync client retry what can never succeed, and every
refused request writes a stack trace into `error_events`.

**CLEAN:** cross-user protection holds across nutrition/cardio/activity too (nine probes, owner's rows
re-read, control for each) — so **all four write pillars are now probed and none leaked**. And the
seven idempotent `DELETE`s returning 200/204 for an absent row are **defensible, deliberately not
filed** — the reasoning is in the review so it is not re-litigated.

**Section coverage so far.** The write surface is swept for workouts, nutrition, cardio, activity,
and (via the app-wide probe) body/devices/platform/app-shell. **`sleep`, `readiness` and `heart-rate`
barely expose dynamic write routes at all** — they are read-and-derive pillars whose writes arrive
through ingest and sync, so they need a different lens, not this one. That is the next sweep.

### Sweep 3 — the workout write path, driven live and probed cross-user (2026-08-18)

Owner-requested: review the workout logic and screens. Took the gap this baton named — **the write
surface**, which every prior sweep had left (`GET` only). Write-up:
[`docs/reviews/2026-08-18-workout-write-path.md`](../../reviews/2026-08-18-workout-write-path.md).

**Filed — Q-460 … Q-462.** Q-460/461 upper-mid (above Q-353), Q-462 low.

| Q | | What |
|---|---|---|
| Q-460 | 🟠 | `POST /api/workout-sessions/rpe` returns `{"success":true}` for a write that matched nothing; `pushMutations` then `processed++`s it and **drops the outbox mutation**. Rule (a). **Lane A.** |
| Q-461 | 🟠 | `Start Set 2`'s infinite `animate-bounce` blocks Playwright's stability check → **the core write path cannot be E2E-driven past set 1**. Testability only; a human is unaffected. **Lane B.** |
| Q-462 | 🟡 | An ownership refusal on `/api/log-exercise` surfaces as a 500. Block is correct; reporting is not. |

**CLEAN — and the headline is a clean result:**

1. **Cross-user write protection holds across the whole workout surface.** A second live account
   against the owner's real ids: `workout-entry` PATCH/DELETE → 404, `workout-sessions` DELETE → 404,
   `log-exercise` → refused, `prescribe` → 404; owner's rows re-read and unchanged.
2. **The outbox cannot be wedged** by one bad workout mutation (per-mutation `try/catch`).
3. **The flow runs end to end** on web — zero uncaught page errors, zero failing `/api/` responses.
4. **Two near-misses cleared:** the "▲ +2.00 kg" 1RM delta is exact (stored PR is 98, not the 97.5
   header, which is the previous session's estimate); the warm-up "92% = 70 kg" is a fixed target
   percentage with plate-rounded weight, by design.

**Method lesson worth keeping: run a control for every ownership probe.** An early `PATCH` returned
`400 Invalid body`, which reads exactly like protection and was actually my payload breaching the
schema's `max(500)`. The same-call-as-owner control is what exposed it. Also: the UI drive produced no
`POST /api/log-exercise` and that is **not** a bug — the POST fires when an *exercise* completes, not
per set.

### Sweeps 1–2 (2026-08-17, both merged: #16, #38)

**Four of the thirteen findings have already been implemented** by the Implementation lanes — Q-450 (#31),
Q-451 (#33), Q-452 (#39), Q-457 (#44) — so a Q number missing from the backlog queue is finished, not
dropped. Nine remain open: Q-453, Q-454, Q-455, Q-456, Q-458, Q-459, Q-460, Q-461, Q-462.

### Sweep 2 — the public/private boundary as an architectural property

Owner-requested: review the architecture specifically with respect to the repo migration. Write-up:
[`docs/reviews/2026-08-17-repo-migration-architecture.md`](../../reviews/2026-08-17-repo-migration-architecture.md).

**Filed — Q-456 … Q-459.** Q-456/457 upper-mid (above Q-313), Q-458/459 low.
**Status column checked against `main` on 2026-08-17 — do not trust it after that without re-checking.**

| Q | | What | Status |
|---|---|---|---|
| Q-456 | 🟠 | The owner's production user ID is baked into **18 committed migrations**, and `CLAUDE.md`'s "re-run the generator into a new migration" rule re-publishes it on every schema change. Not a credential; fix the generator, not the files. **Lane A.** | **open** |
| Q-457 | 🟠 | `lib/github-release.ts:24` defaulted `APK_RELEASE_REPO` to the **archived private repo**. | ✅ Lane B, #44 |
| Q-458 | 🟡 | `.env.example` wrong both ways — 8 dead keys incl. `TOKEN_ENC_KEY` (names a security property the app lacks) and 5 Oura **Cloud** keys; 4 real vars undeclared. | **open** |
| Q-459 | 🟡 | The rolling `apk-latest` release is delete-then-recreate → the public download URL 404s on every native merge. | **open** |

**CLEAN — six areas, including the two that mattered most:**

1. **No credentials published.** No GitHub/Google/OpenAI-shaped keys, no PEM private keys, no `.env`
   (only `.env.example`, values all empty), no keystores, no tracked build output.
2. **No third-party personal data.** The only real emails belong to bundled library authors.
3. **The public-repo CI posture is correct.** All three workflows use `pull_request`, **not
   `pull_request_target`**; `ci.yml` uses no secrets; the APK publish is gated on `push` so forks
   cannot reach it.
4. **A fresh clone's tests genuinely work** — synthetic constants are committed and `vitest.config.ts`
   falls back to them when the real `MANIFEST.json` is absent. That is the path CI takes every run.
5. **`AWS_*`/`STORAGE_*` is a deliberate alias chain, not two schemes.** Checked and cleared — a
   near-miss recorded so it is not re-raised.
6. **`private-paths.json` is well built,** down to deliberately non-specific descriptions so the
   inventory is not a map to what it protects.

**Noted, not filed:** `private-paths.json` protects a third party's IP; nothing plays that role for
this project's own users' identifiers. Q-456 reached a public repo because no gate was looking.
Second list, or widen the first? A design decision, not a review finding.

### Sweep 1 — the failure cells, exercised live (PR #16, merged)

**PR #16 carried this sweep and is merged.**

> **A method warning worth more than the finding it came from.** This session spent a long stretch
> convinced CI had stalled: Lint/Custom Rules/Migration Check went green in under a minute while
> Tests/Build/E2E sat `in_progress`, and repeated polls kept showing no movement. It looked like a
> 70-minute hang and was written up as one. It was not. **The sandbox's backgrounded `sleep` calls
> are throttled and batched** — several fired at once, long after they should have — so the polls
> were minutes apart in wall-clock terms, not the hour they felt like. `date -u` settled it: five
> minutes had passed, and CI was running perfectly normally (the sibling PR completed all six checks
> in 4.5 minutes). **Check `date -u` before concluding anything is slow or hung here.** Elapsed time
> inferred from your own polling cadence is not evidence.

**Lens run: the failure cells, exercised live** — the error path, the empty state, the first-run
path, the entry point reached out of order. Write-up:
[`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](../../reviews/2026-08-17-failure-cells-running-the-app.md).

Why that lens: the six-round comprehensive review that closed the same morning states its own limit —
*"Nothing in six rounds was rendered — no device, emulator, browser, or `pnpm dev` run."* Thirty-eight
backlog entries, none of which could have come from watching the app behave. Running it was the whole
edge, and it paid immediately: **the two worst findings are dead primary actions that source-reading
had walked past repeatedly.**

**Filed — Q-450 … Q-455** (Q-450/451 sit directly below Q-310 at the top of the queue):

| Q | | What | Status |
|---|---|---|---|
| **Q-450** | 🔴 | `/activity` reached without a type: Start works, Finish works, **Save silently discards the activity**. Two in-app paths reach it. | ✅ #31 |
| **Q-451** | 🔴 | A no-program account's **Workout tab** is a ~1,400 px empty card with a **dead "Start Workout" button**. | ✅ #33 |
| Q-452 | 🟠 | The AI insight card runs an LLM over a prompt of literal `"no data"` strings; tells a day-one user their inactivity is a "significant gap". | ✅ #39 |
| Q-453 | 🟡 | `/api/training-stress` silently answers for *today* on a malformed `date`; its ten siblings all 400. | **open** |
| Q-454 | 🟡 | Two routes validate params before checking auth (**no data leaks** — verified). | **open** |
| Q-455 | 🟡 | An unhandled throw returns a **bodiless 500**, not a JSON error. | **open** |

**Came back CLEAN — a real result; do not re-cover without a reason:**

1. **The `[-/]` date-separator class.** All 11 date-taking routes accept **both** separators, hit
   live. The bug class `CLAUDE.md` documents at length is not currently present.
2. **The unauthenticated surface.** 122 GET routes with no cookie: **114 exact 401**, 3 admin 403, 2
   deliberately public, 3 filed as Q-454. **No route served user data unauthenticated.**
3. **A zero-data account across those same 122 routes.** Exactly **one** differs from the seeded
   user, and it is a clean `404 {"error":"No active program"}`.
4. **Crash-freedom and empty states.** 51 renders (30 seeded + 21 zero-data): zero uncaught page
   errors, zero console errors, zero failing `/api/` responses. Empty states are genuinely well built
   **apart from Q-451**.

## Next

Pick a lens nothing has covered recently. What this sweep deliberately left, roughly in order of how
much it is worth:

- **The rest of the write surface.** Sweep 3 covered the **workout** mutations only. Still unprobed:
  the program / phase-set / progression-style / template routes, and every non-workout domain. And
  rule (b) — **raw request bodies passed into Drizzle `.set()`** — was never systematically audited in
  any sweep; it is the one of the three ownership rules with no evidence behind it.
- **The offline path and the error path.** Two of the four failure cells named in the role brief were
  **not** exercised — everything here ran against a healthy server with a live network.
- **Production data.** This sweep used only the fresh local seed, so it says nothing about prod drift.
  `POST /api/admin/db-query` over the `claude_ro` views was **not** used at all.
- **Q-452's siblings.** Only the four `AiInsightCard` sections were checked; `weekly-digest` and the
  coach were not checked for the same absent-vs-zero confusion. *Sibling-surface sweep* applies.

From sweep 2 (the repo migration):

- **A clean clone, actually built.** Sweep 2 read the tree and argued the fresh-clone claims from the
  committed fixtures and CI's behaviour. Nobody has done `git clone` into an empty container and run
  `pnpm install && pnpm build && pnpm test`. That is the one check that would settle `NOTICE`'s claim
  outright, and Q-313 (no `next build` gate in the publish dry-run) is the reason it is worth doing.
- **The archived private repo was not examined.** The public repo's single-snapshot history is what
  bounds the exposure question here; that reasoning does not transfer to the archive.
- **Secret detection was pattern-based.** Strong evidence of absence for conventional formats, not
  proof for a bespoke or high-entropy-but-unpatterned credential.

## Blocked

Nothing. But note the standing ceiling: **the device.** Everything this role can run is the **web**
build — `getLocalStore()` returns null, so every offline-first domain takes its web fallback and the
canonical runtime is never touched. No safe-area, Samsung-WebView, native-plugin or native-SQLite
finding can originate here, and every write-up must say so.

## Claimed paths

None. This role's PRs are docs-only.

## Do not re-litigate

- The role's authority limits and the lane contract are settled in
  [`docs/agents/README.md`](../README.md). Read it rather than re-deciding it.
- Take Q numbers from the band above, not from the backlog's next-free pointer — and claim against
  **every open PR** too, since the pointer cannot see an unmerged one (that has already caused a real
  collision, Q-297).
- **Queue position is priority; Q number is not.** Q-450 above Q-310 was deliberate.

## Method notes, so the next session does not re-derive them

- `pnpm db:local`, then `env -u DATABASE_URL -u DATABASE_SSL pnpm dev`. **Both vars are pre-set to
  production in the container and Next will not let `.env.local` override an already-set
  `process.env` var** — without the `env -u`, the dev server silently tries production and fails.
- API sweeps: sign in with `curl` via `/api/auth/csrf` → `/api/auth/callback/credentials`
  (`test@local.dev` / `testpass123`) into a cookie jar.
- A zero-data account is worth the two minutes: copy the seeded user's `password_hash`, then
  `update users set is_active=true`. **Without that update, sign-in 302s and leaves a null session** —
  which reads like a broken login and is actually the invite gate working correctly.
- Screens: temporary specs in `e2e/` using the repo's own Playwright config (S25 viewport, sandbox
  Chromium), run against the already-running server with `E2E_BASE_URL=http://localhost:3000`, and
  **deleted before committing**. Capture console errors, `pageerror`, failing `/api/` responses and
  rendered text length — text length is what surfaced both blank screens.
- **First-visit renders are confounded by Turbopack compile time.** Anything that looks sparse must be
  re-checked warm before it is believed; both blank screens here were, and both reproduced.

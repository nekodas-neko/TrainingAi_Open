# Review sweep 50 — the twelve-day catch-up

**Branch:** `claude/review-agent-sweep-40-wu6ss3` · docs-only · Review Agent.
**Write-up:** [`docs/reviews/2026-09-18-sweep-50-twelve-days.md`](../../reviews/2026-09-18-sweep-50-twelve-days.md).

The owner asked for a full review of everything added since the last one, checked from every angle —
performance, safety, logic, efficiency. Base was sweep 49's `3e47f03f` (2026-09-06): **12 days, 50
commits, 671 changed code files**. Run as three read-only lanes (new API-route safety, new
shared-module math, cache and staleness) plus a performance lane, all reporting into this session,
with **every finding re-verified at source by the coordinator before filing** — nothing below is
taken on a lane's word.

## Filed: RV-51 … RV-63

One live, user-affecting defect and twelve that are latent, structural or cosmetic.

**RV-51 is the one that is happening now.** `equipmentEligible` (BF-129) excludes an exercise that
declares no equipment and justifies it with *"Migration 269 labelled the 22 rows that had drifted …
so an empty list should not occur"*. Production holds **2 of 156** rows with `equipment = []` —
`Dumbbell Lunges` and `Cable Lat Pulldown` — and because the implementation is `.some()`, an empty
array is false against **every** selection including `full_gym`. Both are invisible to
`generate-program`, `builder-chat` and the builder review filter, for every user, at every setting.
Filed with the question the data raises attached: `exercise_library` has no `created_at`, so whether
migration 269 *missed* these or something *wrote* them afterwards is unestablished — and if it is the
latter, labelling two rows fixes nothing.

The rest fall into one shape, which is the finding worth carrying: **a rule was written down
correctly and then only half-applied.** `STREAK_LOOKBACK_DAYS` calls itself a contract between two
files and is imported by one of them (RV-57). `equipmentEligible` lowercases the exercise side and
`buildEquipmentSet` lowercases neither (RV-58). `summariseSupplementDay`'s header names a mixed-unit
day as a reason it was hoisted, and then sums across units and labels the total by row order
(RV-59). `recommendWalkPattern` ships two user-facing strings to distinguish two cases, one of which
cannot fire (RV-60). Three cache keys sit in **zero** invalidation groups beside siblings in three
and four (RV-52/53/54) — the sharpest being `collection`, which `/api/collection:59` computes from
exactly the deload confirmation `invalidatePrescriptionChanged()` exists to fan out. That is a better
class of bug than sweep 49's, and also the class a reader cannot catch, because the comment says the
right thing.

Two routes turn a client error into a server fault and an `error_events` row — a client-supplied vial
`id` colliding into an unhandled `23505` (RV-55) and three date params validating separator but not
calendar (RV-56, the Q-496 class). `/api/collection` is the only new route both unbounded and
rate-limit-free, re-running five all-history reads on every home paint (RV-63). A banned ms-offset
window landed on the mood check-in write path (RV-62). And `PATCH /api/user/equipped-title` never
checks a title is unlocked (RV-61) — **pre-existing, and this diff hardened the same line**; filed
because the sweep found it, not because it regressed.

## BF-110's reading is in, and the entry was still parked

The entry set its own decisive criterion — *"`stuck` → the viewport is genuinely held and the fix is
native"*. `error_events` has **3 rows** of `recheck stuck h1=667 h2=667`, 12 healthy at 826→826, and
**0 `resized`, 0 `dom-lost`**, dated 2026-09-15→09-16. **Native-layer verdict, four days old.** Two
telemetry corrections went onto the entry in the same pass: the word `stuck` fires on healthy resumes
too (12 of 15), and `w=384` appears on every row including the healthy ones — so the "384×667"
signature is half right and **only the height discriminates.**

## Two stale numbers corrected in `CLAUDE.md`

Both in the session-start block every agent reads first, so both were actively misleading.
`error_events`' 52 MB was described as "30 days of retained payload rather than unbounded growth";
measured today it is **12 MB heap + 39 MB TOAST + 752 kB index behind 115 live rows** — bloat, not
payload, and the figure was written when the table held 7,331. Growth was stated as ~0.4 MB/day;
it is **1.71 MB/day against 224 MB total**. The amendments keep both rules and fix the numbers,
and say what to watch instead: the *shape* (a window that stops reclaiming), not the daily figure.

## What was clean, and it is most of it

Admin authorisation on both new admin routes, proved by revocation rather than by reading — flipping
`is_admin` to false in Postgres answered 403 on the same cookie. Ownership rules (a)/(b)/(c) on the
vials routes, cross-user PATCH/DELETE both 404 with the victim row read back unchanged. `private,
no-store` on every new route. Zero N+1 queries in the added data layer, confirmed on the wire. Every
new query pattern from migrations 267–277 has a supporting index. No new dependency in 671 files.
Eight of the twelve new shared modules survived adversarial probing of the shipped module unchanged.
`check-memo-prop-stability`, `check-component-size`, `check-fetch-once-effects` and
`check-cache-ttl-divergence` all exit 0 with nothing new. `pnpm check:rules` reports **Ran 75 of 75**
(68 at sweep 49).

## Not exercised

Nothing device-verified — every probe ran in node or against a local dev server, so the offline-first
half of the new vials domain was not touched at all. `claude_ro` reads are **the owner's rows only**
except the catalogue, whose view scoping was not verified, so "2 unlabelled rows" is a floor. No
`EXPLAIN ANALYZE` evidence (the local planner seq-scans everything at 9–145 rows) and no bundle
sizes. `rederive-baselines`' write path never ran — the table is empty locally. The ~33 *changed*
formula files were greppped for duplicates, not audited.

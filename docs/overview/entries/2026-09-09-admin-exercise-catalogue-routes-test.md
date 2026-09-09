# 2026-09-09 — the exercise catalogue's four verbs, and what the ratchet cannot see (PS-39, stays at 22)

**Branch:** `test/admin-exercise-tool-routes` · **No product change.**

15 cases over `admin/exercises` — the last route [#1019](https://github.com/nekodas-neko/TrainingAi_Open/pull/1019) changed without a test of its own.

## The count does not move, and that is the point worth recording

`admin/exercises` **already counted as covered**: `lib/data/postgres/__tests__/body-supplied-id-guards.test.ts`
imports the handler to assert one ownership property. So the ratchet reads 22 before and after.

That is the ratchet's own distinction, one level up. Its header explains that *a substring is not an
import* — a test mentioning a URL does not cover a route. The same reasoning continues: **an import
is not a test of behaviour.** A file that imports a handler to check one guard makes the route
indistinguishable, to the counter, from one with fifteen cases across four verbs. The number is a
floor on attention, not a measure of it, and the routes most worth revisiting are the ones already
below the line.

No new check proposed for this — a coverage metric that tried to judge *sufficiency* would be
inventing a threshold nobody could defend. Recorded so the next reader knows the count under-reports
in exactly this direction.

## Three documented defects, each now a case

- **RV-45 — a delete that removed nothing answered `{ ok: true }`.** It deletes by NAME, so a stale
  or misspelled one silently did nothing while reporting success; the admin screen does
  `if (!res.ok) throw`, so a false success leaves the row on screen until a reload contradicts it.
- **RV-47 — a malformed id 500'd and filed its own SELECT into `error_events`.** The same route
  answered 404 for a well-formed missing id and 500 for a malformed one: one payload, one field,
  differing only in format.
- **Q-320 — every update error answered 409 with its own text as the body**, so a missing row read
  as a name clash and a driver failure published its statement. The status now comes from the thrown
  error, and **only an unmarked one is reported** — filing a refusal into `error_events` buries the
  real faults in the table every session reads at start-up.

Also pinned: PATCH **clears a cached GIF when the update carries none**, so the auto-matcher gets
another go rather than keeping a picture that no longer matches the exercise.

## Two fixtures the mutation pass rejected

**The case-insensitive join lowercases twice** — once building the map, once looking up — and my
first fixture had an already-lowercase cache row, so removing the map-key normalisation changed
nothing and survived. Both names are now mixed-case, which is also how they arrive in practice: the
library is human-entered and the cache is filled by a matcher.

**A missing id and a malformed one both answer 400**, so a status-only assertion could not tell the
two guards apart — dropping the missing-id check let an empty string fall through to the uuid guard
and still 400. The case now asserts the *messages*, because "you sent no id" and "that is not an id"
are different things to fix.

## Mutation pass

**14 of 15 caught** after those fixes. The survivor is an equivalent mutant planted as a control.

## Not exercised

Drizzle is a chainable stand-in, so no SQL runs — what is pinned is which values reach the insert
and delete. The repository is mocked, so the upsert's own conflict handling is not exercised.
Web/Node only: no device, no native surface.

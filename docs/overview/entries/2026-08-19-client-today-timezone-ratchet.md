# 2026-08-19 — a ratchet on client "today", and main was red (Q-477 step 1)

**Branch:** `ci/client-today-timezone-ratchet` · **Lane:** Implementation A

## What shipped

Q-477's fix shape is explicit: **step 1 is a CI ratchet that "should land first and on its own"**,
step 2 is the sweep, which is Lane B's. This is step 1.

`scripts/check-client-today-timezone.js` — step **50 of 50** in Custom Rules. It flags a bare
`todayInTz()` or `localDateString()` anywhere in client code (`app/**` except `app/api/**`,
`components/**`, `lib/hooks/**`, `lib/stores/**`) against a **shrink-only per-file baseline**.

Three answers to "what day is it" ship at once: `todayInTz(tz)` follows the user's setting,
`todayInTz()` falls back to Brisbane, and `localDateString()` reads the *device's* zone. All three
agree while a user is on `Australia/Brisbane`, which is why this survived — the wrong call compiles,
type-checks, lints clean, and is correct on the only device anyone tests on.

## Re-measured, and the headline count does not reproduce

The entry says **100 of 125** client call sites are wrong. The script finds **78 bare calls across 38
files**, over **522 client files scanned**. The difference is the file set, not a fix. The entry's own
argument applies to its own number — so the annotation now points at
`node scripts/check-client-today-timezone.js --print` instead of restating one.

## Proven to bite, because a check that never fails is decoration

| probe | result |
|---|---|
| bare call added to an **unlisted** file | **fails** — `components/ui/sparkline.tsx  1 bare call(s), baseline 0` |
| extra bare call in a **listed** file | **fails** — `2 bare call(s), baseline 1` |
| a correct `todayInTz(tz)` added | **passes** — no false positive |
| a bare call **removed** without lowering the baseline | **fails** — "shrink-only … lower them in the same PR" |

Tree restored after each probe; the check reports the same 78 either side.

## Along the way: `main` itself was red on Custom Rules

`check-doc-index-size` was failing on a pristine `origin/main`, which fails **every** branch, not just
this one. Cause: **#245** (Q-549 measured) and **#246** (Q-529 ring cadence) each grew
`docs/implementation-backlog.md` and each was green against the 11127 baseline when its own CI ran —
their sum is not. A parallel-merge race, and precisely the failure mode that file's own header warns
about.

Baseline re-measured to **11173** rather than picked, with the cause written beside it.

**A small trap worth recording:** `wc -l` said 11157 and the check said 11158, so the first raise was
one short and still red. `wc -l` counts newlines; the script counts lines. **Take the number from the
script that enforces it** — the same "re-measure, never pick" rule, one level down.

## Not exercised

The sweep itself — deliberately, it is Lane B's and the entry orders the ratchet first. Nothing on
device: the 9 `localDateString()` sites read the *phone's* zone there, a third value this harness
cannot reproduce. Nothing against production, where every user row is Brisbane and the symptom does
not arise. No route, no migration, no schema change.

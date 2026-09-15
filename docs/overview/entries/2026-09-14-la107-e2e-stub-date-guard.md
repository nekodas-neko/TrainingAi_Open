# 2026-09-14 — a guard for the literal-date fixture, and what measuring first changed about it

**Branch:** `lane-a/la107-literal-date-fixture-guard` · **Lane:** A · Entry **LA-107**, filed hours
earlier in #1183 when the class it describes took E2E red on every branch.

## The entry's own method instruction was the load-bearing part

LA-107 said to measure the corpus before writing the regex, and it named a candidate discriminator:
a literal date *in the same file as* `todayInTz`, `AT TIME ZONE`, `Date.now()` or `new Date()`,
since that pairing is the both-sides-fixed rule being broken.

**Measured against the very case that motivated the entry, that discriminator does not catch it.**
The pre-fix `nutrition-budget-honesty.spec.ts` contained no clock reference of any kind — no
`new Date()`, no `todayInTz`, nothing. The clock lives in `nutrition-content.tsx`, the application
the spec drives, not in the spec. Nine of the twelve e2e files holding a literal date have zero
clock references. The signal does not discriminate at all, and a check built on it would have gone
in, passed, and proved nothing.

## What the corpus actually looks like

308 files hold a literal `YYYY-MM-DD` (12 under `e2e/`, 296 under `__tests__/`). Flagging all of
them is the noise the entry predicted. The shape the defect takes is narrower: a literal date handed
to the app **through a `page.route` stub**, where the app is free to compare it against today. That
flags five files, and all five were read:

| spec | why its literal is safe |
|---|---|
| `day-rollover-checkin` | `page.clock.install` pins the app clock to that instant |
| `nutrition-day-rollover` | same, across a pinned rollover |
| `stress-by-hour` | `at()` derives every timestamp from `Date.UTC(2026, 8, 8, …)`; the `date` field matches |
| `sleep-provisional` | green with a date **12 days stale** — the sleep list renders the nights it is given |
| `home-device-battery-chips` | sunrise/sunset labels, rendered as given; green 12 days stale |

**Zero current defects.** The only true positive in the corpus is the one #1183 already fixed.

That could read as an argument against shipping the check, and it is the opposite. The last two rows
are safe *by luck of their consumer*, and nobody had established that until today — a date-guarded
consumer would have failed on the first rollover rather than surviving twelve. The exemptions are
where that knowledge now lives.

## What shipped

`scripts/check-e2e-stub-dates.js`, wired into Custom Rules — the runner reports **75 of 75**, up
from 74, which is the number to quote rather than the word "pass".

Exemptions are per **(file, date)**, not per file, so a new literal added to an already-exempt spec
still fails. Each carries the reason measured above.

**The check caught a flaw in itself on its first run.** Its initial regex treated backticks as quote
characters and flagged a date inside its own header prose, which is exactly the sort of finding that
gets a check deleted rather than fixed. It now strips comments via the existing
`scripts/lib/strip-comments` helper and matches quote characters only.

## Verification

**Mutation pass, real exit codes captured** (`node … > log 2>&1; echo $?`, never piped to `head` —
the first attempt reported `head`'s zero while the script was failing correctly):

| mutant | exit |
|---|---|
| reintroduce `date: '2026-09-14'`, the literal that broke `main` | **1** — flagged |
| a new literal inside an already-exempt file | **1** — flagged, so the exemption is not a blanket |
| control: swap two exempt dates' declaration order | 0 — survived, as an equivalent change should |

## What is deliberately not covered

**Unit tests.** `scale-ble-day-keying.test.ts` is the same rule broken in a different shape — one
side of a rolling window hardcoded — and no `page.route` appears in it. 296 test files hold a
literal date, so the same coarse rule there would be all noise. This guard is narrower than the
class it belongs to, in the way `check-backlog-pointers`'s empty-heading rule is narrower than
resurrection: it catches the shape that has actually shipped twice, and says so rather than implying
the class is closed.

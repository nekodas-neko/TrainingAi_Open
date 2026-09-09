# 2026-09-09 — a supplement froze two contradicting doses; the engine half is fixed (OR-104)

**Branch:** `fix/or104-supplement-dose` · engine half only; the sheet is Lane B's.

`Retatrutide` carried `default_amount 0.5 · unit mg` **and** free-text `dose '10mg'` — the vial
strength, typed into a field the edit sheet labels `Dose`. Every log froze both, 20× apart, and the
2026-09-07 log already has. Invisible, because `supplementSubtitle()` reaches for the free text
last: the list read "0.5 mg today" while the archive kept the wrong number for every later reader,
including the dose tracker OR-102a/b will build on it.

Both write paths now freeze the definition's free text **only when no structured amount was
resolved**. Existing rows are untouched on purpose — the freeze is the point of BF-3, and the live
row is the owner's to correct by hand.

## One rule, because there are two write paths

The server (`adapter.ts`) and the offline store (`sqlite-backend.ts`) both stamp a dose, and a log
written offline must not disagree with one written online. The decision lives in
`freezableDoseText` (`packages/shared/src/nutrition/supplement-dose-freeze.ts`) and both call it.

**That was not tidiness — it was the only way to test the local path.** The local suite asserts
against **source text**: it greps `sqlite-backend.ts` rather than running it, because `getLocalStore`
returns null under node. So my change to that file passed its entire suite untouched, and a mutant
reverting it survived. Moving the rule into shared code put it somewhere a test actually executes;
the local suite then gets a delegation assertion, which is the half that catches the wiring being
undone. Neither alone is enough.

## What the fixtures had to be

The existing BF-3 tests all used a definition whose free text **agreed** with its structured amount
(`dose: '2 mg'` beside `defaultAmount: 2`). That is the equal-values trap: with the two agreeing,
nothing distinguishes "stamped the prose" from "stamped the number", so those cases could never have
caught this. The new case uses the production shape — `0.5` against `'10mg'` — where only one answer
is possible.

Five existing assertions changed from `dose_text: '2 mg'` to `dose_text: null`. **The freeze is not
weakened**: for a supplement with a structured amount it now rests on `amount`+`unit` alone, and the
case that made BF-3 urgent — a supplement carrying *only* free text — still freezes it, untouched.

My own new test then caught a gap in my own helper: `''` came back as `''`. The two paths had
already disagreed there before the shared function existed (the local store used a truthy check, the
server `?? null`), so blank and whitespace-only now count as absent.

## Found, and deliberately not fixed here

**LA-90 — the two paths merge a caller-supplied dose differently.** The server merges per field
(`dose?.amount ?? owns.defaultAmount`); the local store is all-or-nothing, reading the definition
only when amount, unit and doseText are *all* null. A caller supplying only `amount` gets the
definition's unit on the server and null offline. No caller does this today, which is precisely why
it is a trap for the next one. Left out because bundling a second divergence into a dose-text fix
would have made both unreviewable.

**LA-91 — no CI job sets `timeout-minutes`.** Filed with measured durations, and the near-miss is
the useful part: a check-in of mine asserted "25 minutes is beyond plausible" for the E2E suite; the
real run took **24:36**. Acting on that guess would have re-triggered a healthy run two minutes
before it went green. Reading `playwright.config.ts` — 77 specs at `workers: 1` — answered it in a
minute, and the reason nobody knew is that most PRs skip E2E in ~35s via its UI gate.

## Mutation pass

**8 of 8 caught** after the two fixes above; the ninth is an equivalent mutant planted as a control.

## Gate

`pnpm lint` 0 errors · `npx tsc --noEmit` clean · **Custom Rules 70 of 70** · full suite
**867 files, 8166 passed, 0 failed** · `check-backlog-pointers` OK (334 entries).

**Not exercised:** the local SQLite path does not run in this sandbox, so its behaviour is covered
only through the shared function plus a source-level delegation assertion — **not on a device**. No
migration. The manage sheet is unchanged, so a user can still type a contradicting free text into a
definition; only what a log freezes has changed.

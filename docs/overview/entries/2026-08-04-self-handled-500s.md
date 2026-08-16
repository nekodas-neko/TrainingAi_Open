# 2026-08-04 — Q-58 part 2: the routes that caught their own 500 and said nothing

**Branch:** `feat/route-error-reporting-self-handled` · **Domain:** platform · **Version:** 1.256.3

## What this covers that part 1 could not

Part 1 (v1.256.2) added `onRequestError`, which sees every error that **escapes** a route handler.
A route that catches its own error and returns `NextResponse.json(..., { status: 500 })` never
escapes anything, so the global hook never fires for it. 21 route files were in exactly that state:
they knew they had failed, told the client, and told nobody else.

Coverage now: **30 of the 31 route files that can return a 500 report it.**

## Not a blind sweep

The insertion was scripted, then every one of the 21 hunks was read. Three things came out of that
which a script alone would have got wrong:

**Two routes would have logged normal user actions as server faults.** `POST /api/exercises` and
`POST /api/workout-templates` both catch, check whether the message says "duplicate"/"already
exists", return **409** if so, and fall through to 500 otherwise. Reporting at the top of the catch
means every time the owner picks a name they've already used, it lands in the error table. The call
now sits *past* the 409 branch. `log-calendar-event` is the same shape with a 403 for a missing
calendar grant — which is the common case on that route, not a fault.

**Five routes declare `userId` inside the `try`,** so it isn't in scope in the `catch`. Typecheck
caught all five; they report with the URL alone rather than being restructured for the sake of one
field. The URL, message and stack are the diagnostic payload; `insertErrorEvent` takes a null user.

**One route used a bare `catch {`** with no binding, so the script's pattern skipped it entirely
(`exercises/generate`). Given a binding and a report.

The import insertion also broke on a multi-line `import { ... } from` — it landed *inside* the
braces and produced a syntax error. Typecheck caught it immediately; worth knowing before trusting
"insert after the last import line" on any future sweep.

## The one route deliberately left alone

`scale-ble/pending/[id]/confirm` returns a 500 from a **data-shape guard**, not a catch — the stored
reading is missing its decoded fields. Reporting a validation branch as a server exception would be
wrong, and whether that case should be a 500 at all is a separate question. Left as-is rather than
forced to fit the pattern.

## Verification

Typecheck, lint and the full suite (3096) green. Every hunk read individually — the three
corrections above are the product of that read, not of the tooling.

**Not verified: production.** These are one-line additions to existing catch blocks with no
behavioural change to any response, and `reportServerError` is fire-and-forget and already proven on
13 other routes. The failure mode of a mistake here is a missing log line, not a broken route.

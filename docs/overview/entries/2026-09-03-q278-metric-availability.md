# 2026-09-03 — a score's "why", built from what the producers can actually tell apart (Q-278)

**Branch:** `feat/score-coverage-surfacing` · the engine half. Lane B owns the surfaces.

## The real content was in a branch that already existed

Q-278 is about a score that cannot be computed reading the same as one that can. The entry's own
audit had already established the surfaces render `—` correctly — *"what is missing is only the
why"*. The why turned out to be sitting in `readiness-composite.ts`, discarded:

```ts
if (z == null || nHistory < BASELINE_MIN_NIGHTS) return NEUTRAL
```

Two different situations, one indistinguishable result. `z == null` means **there is no input**.
`nHistory < BASELINE_MIN_NIGHTS` means **there is an input and the baseline is too cold to score
it**. Those read completely differently to a user, and **only the second is fixed by waiting** — so
only the second can be told to someone as such.

`ReadinessContributor` now carries `gap: 'no_input' | 'awaiting_baseline' | null`.

⚠ `provisional` is unchanged and still carries two senses: `recoveryIndexScore` is `provisional`
because its *curve* is an approximation, not because anything is missing, so its gap is null. That
overload is part of why this entry existed — it should not be "tidied" into `gap`.

## The representation is keyed on the metric, which dissolves the blocker

Q-278 could not start because it asked whether daytime stress and resilience count as "pillars".
`metricAvailability(metric, value, contributors)` takes whatever the caller renders, so the ruling
never has to be made and a sixth metric costs nothing. It returns `state`, a `gap` when absent, and
`degradedInputs` for a value that WAS produced from an incomplete picture — which is what lets a
surface say *"computed without HRV"* instead of only *"limited"*.

A mixed set of causes resolves to `no_input`: waiting cannot fix the half that has no data at all, so
the optimistic answer would be the misleading one.

**Two enum members, because that is what the producers distinguish.** The entry warned against
building `below_gate`/`not_yet` from what reads well. Nothing computes those, and they would have
turned the "why" into a constant — the exact failure it predicted.

## The test that mattered was the one against the real producer

Six tests build contributors by hand. Those would all pass if `computeReadinessComposite` never set a
gap at all — a taxonomy nothing populates, passing its own tests. Three more feed a **real** composite
in, and mutation-checking confirms it: collapsing the split back into one `NEUTRAL` fails them.

⚠ **The first version of that fixture omitted `checkinScore`, and the cold case reported `no_input`.**
That was correct — a missing check-in *is* missing data — so the fixture was wrong, not the code. An
incomplete fixture silently tests a different question, which is why the one that ships is exhaustive.

## Response shape

`/api/readiness-score` returns `availability` for readiness, sleep and activity. **Optional on the
type, deliberately:** clients seed this payload synchronously from SQLite, so a device can paint from
a response written before the field existed, and a required field would be a claim about what a
client can receive that is not true.

Readiness carries contributors, so its reasons are real. Sleep and activity have no contributor
breakdown and report only present/absent — less, but honest.

## Not verified

An **authenticated** `/api/readiness-score` response. The route compiles and 401s without a session,
and the sandbox cannot mint one. Nothing ran on a device; nothing here is user-visible yet, since
consuming `availability` is Lane B's half.

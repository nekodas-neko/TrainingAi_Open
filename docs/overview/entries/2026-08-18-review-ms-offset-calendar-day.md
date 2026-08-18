# 2026-08-18 — Review: turning an ms offset into a calendar day

**Agent:** Review 📖 · **Branch:** `claude/review-ai-tool-surface` · **Docs-only.**
**Filed:** Q-489 · **Review:** [`docs/reviews/2026-08-18-ms-offset-to-calendar-day.md`](../../reviews/2026-08-18-ms-offset-to-calendar-day.md)

## Why

`CLAUDE.md` bans `Date.now() − N×86400000` for stats/AI time windows and records six copies shipping
in `lib/ai-chat/tools.ts`. That file is clean now, but 12 instances remain elsewhere and nobody had
sorted the ones that matter from the ones that do not.

## Most of them are correct

The rule's harm is *"ms-offset windows straddle two AEST days and merge them"* — that is about
**day-bucketed** aggregation. `muscle-recovery`, `workout-load-history` and `friends/feed` use a
**rolling instant** filter feeding consumers that work in hours: `computeMuscleRecovery` reads
`ws.startedAt.getTime()`. For a physiological window a calendar day would be *less* correct.

**A sweep that grepped the pattern and filed all 12 would file mostly false positives** — the fifth
consecutive sweep in which the mechanical version of a check was wrong.

## Q-489 — the five that produce a calendar day

Measured in `America/New_York` across the 2026 transitions:

```
ok             local 2026-03-08 00:30   now-24h → 2026-03-07   true yesterday 2026-03-07
ok             local 2026-11-01 00:30   now-24h → 2026-10-31   true yesterday 2026-10-31
** MISMATCH ** local 2026-11-01 23:30   now-24h → 2026-11-01   true yesterday 2026-10-31
```

On the 25-hour fall-back day, in its last hour, `now − 24h` lands on **today**. Three sites compute
"yesterday" that way — the `getOuraDailyDerived` range start, the achievements streak comparison, and
the periodization signal chain.

**Unreachable today** (all users are Brisbane, no DST) and **one hour a year per DST-zone user** when
reachable. Filed because it is measured, it is the hand-rolled date arithmetic `CLAUDE.md` bans, and
`shiftDateStr` already exists and is already used in this exact shape at `slices/oura.ts:1182`.

Q-477 — the Profile timezone setting — is what makes it reachable at all. Same family, neither urgent.

## Clean

`lib/ai-chat/tools.ts` carries none of the banned pattern; the 2026-07-06 fix held. And the
rolling-window uses must not be "fixed".

## Not verified

Measured with `date-fns-tz` directly, not by driving the app with a DST-zone user at that hour — the
app cannot be time-travelled here (`faketime` shifts node's clock but not Postgres's). The consequence
at each call site is read from source.

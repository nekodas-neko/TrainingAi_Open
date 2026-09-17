# 2026-09-17 — BF-173: a sore tick only penalises when the lifter put it there

**Branch:** `lane-a/bf173-sore-muscle-provenance` · **Lane A** · migrations **276** + **277**, local SQLite **v39**

## What was wrong

The app pre-ticked soreness from its own recovery model and then penalised the same muscle a second
time for it.

`suggestedSoreMuscles` auto-selects any muscle trained within 48 h and under 85% recovered — reading
the recovery feed. `sessionRecoveryScore` then read **both** that feed **and** the resulting tick,
and applied `pct = Math.min(pct, 40)`. One fact — *"you trained legs 47 hours ago"* — counted twice,
with the second pass overwriting the model's own figure with a harsher flat one.

The owner confirmed the premise rather than it being inferred: *"It auto picked muscles for me i
didnt choose them manually."* That makes the double count the normal path, not an edge case.

Measured on his 2026-09-17 rows: quads scored **69** became **40**, chest **49** became **40**. The
flat floor also destroyed the ordering the recovery model had just computed — the very thing he was
asking about, that his legs were fresher than his push muscles. It changed the recommendation:
Lower 74 / Upper 84 as shipped, Lower **85** / Upper 84 with the leg ticks removed.

## What shipped

`mood_logs.suggested_sore_muscles text[]` (migration 276, `claude_ro` twin 277, local SQLite v39),
and `sessionRecoveryScore` now clamps only ticks that are **not** in it. An accepted suggestion falls
through to its own recovery pct, which already encodes the same fact.

**Provenance is recorded at WRITE time, never re-derived at score time.** Re-deriving is the option
the owner weighed and rejected — it suppresses the clamp whenever a muscle happens to be
under-recovered, discarding exactly the case the check-in exists for, the lifter telling the model it
is wrong. Recorded once, a muscle he volunteered keeps clamping even after its recovery later falls
below the threshold. A test pins that difference rather than a comment claiming it.

**NULL means "unknown", not "none".** A row written before the column existed cannot say which of its
ticks were suggestions, so it is scored the pre-BF-173 way rather than reinterpreted. An empty array
is a different and meaningful answer: *checked, none were suggestions*.

## The decision inside the decision

The owner chose provenance over suppression. **How** provenance is captured was mine, and it is the
one thing here worth arguing with later: the check-in sheet knows exactly what it drew, but
`components/` is the surface lane's. Rather than ship an engine with no caller — the TN-25 shape,
where a selector landed and nothing invoked it — `saveMoodLog` **derives** the list server-side when
the caller sends none, through the same shared function the sheet calls.

So the fix is live now, with a limit that is stated rather than hidden: a muscle the lifter
volunteered that *also* meets the suggestion conditions is indistinguishable from an accepted one at
the server, and for an offline check-in the derivation runs whenever the mutation reaches the server,
against a recovery feed that has moved on. Both are why the caller's own list wins when present, and
why **LB-116** is filed to send it.

## Expect the clamp to go quiet — that is correct

With provenance in place and an owner who accepts the pre-selection, no tick is lifter-added, so
`Math.min(pct, 40)` stops firing. Do not "repair" it. The recovery pct already carries the same fact.
The soreness-driven deload is untouched and this was verified rather than assumed:
`computePerExerciseDeload` takes `soreMusclesInSession` straight from the mood log and never reads
`sessionRecoveryScore` or the clamp.

## Verification

- 9 unit tests on the scorer, 6 DB tests on the write path. Full suite and `pnpm check:rules` green.
- **Mutation pass: 4 mutants, all killed** — the fix reverted, NULL treated as "all suggested",
  case-insensitivity dropped, and the clamp constant moved. **Equivalent control**
  (`!has(x)` → `has(x) === false`) stayed green.
- **A test caught a real gap rather than confirming intent:** `getMoodLog` did not map the new
  column, and `listMoodLogs` did not either — the "missed row→object mapper" class CLAUDE.md names,
  which fails silently as *"the save doesn't persist"*. Found by the read-back case, not by reading.
- The `claude_ro` twin was diffed against 274: the two differ by exactly
  `mood_logs.suggested_sore_muscles`, nothing else moved.

**Not exercised:** no device, no APK. The local SQLite v39 upgrade path is checked by
`check-local-column-upgrade-path.js` and the reconcile row, not by running on a phone. The
production figures quoted above are BF-173's own measurements and were not re-measured here.

## Filed, not left

- **LB-116** — the sheet sends the list it actually displayed (the accuracy and offline halves).
- **LB-117** — the explain screen will now list sore muscles that no longer lower the score, which is
  the Q-105 reads-as-broken shape. Filed rather than discovered later.
- **BF-171** was blocked on this entry (`Needs: BF-173`) and is now startable — correctly, since
  normalising more muscle names into a fixed double count is what made it worse.

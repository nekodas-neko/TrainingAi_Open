# TN-64 part (a) — record the ACWR, so the gate change can be judged

**Branch:** `lane-a/tn64-persist-acwr` · Lane A · migration **282** + `claude_ro` twin **283**.
Ships alone, as a migration must. **No user-visible change** — nothing renders this number yet, so
no version bump and no changelog entry.

## Why this is its own PR, before the behaviour change

TN-64 found that readiness gates nothing: `earlyDeloadRecommended` is the only place a readiness
score automatically changes what the app prescribes, and it has never fired. The owner answered on
2026-09-24 — extend the recommender to `ai_dynamic`, persist ACWR, keep the confirmation step — and
the entry is explicit that the order matters, (a) before (b).

It is right about the order. The gate fires on `score < 45 AND acwr > 1.2`. The score half is
stored on every day; the ACWR half was computed on each readiness read and thrown away. So from the
stored data, *"the threshold never opened"* and *"the gate was never reached"* are the same
observation. Widening the condition without recording the number first would produce a change
nobody could evaluate — and the entry's own success criterion (*"a prompt appearing on a genuinely
low day"*) needs the input on the record to tell a good prompt from a lucky one.

## Re-verifying the entry, which sharpened its central claim

Every claim checked against current `main` and production before any code:

| entry says | measured 2026-09-25 |
|---|---|
| guard at `readiness-payload.ts:665` | **:667** — one block off, the constants are at :50–51 |
| nothing stores ACWR | confirmed — `acwr` appears nowhere in `schema.ts` |
| 117 sessions, none an early deload | **118** now, still **0** |
| 5 programs, `early_deload_week_start` NULL on all | confirmed, **0 of 5** |

And one thing the entry understates. Of the five programs, **three are `ai_dynamic` and two are
`automatic`** — and the two `automatic` ones are the **oldest** (May 23, Jun 5), both inactive,
while the active program (*Bankai*, Sept 6) is `ai_dynamic`. So the finding is not "the gate rarely
fires". `automatic` is the **legacy** mode; the gate has been structurally dead since the owner
moved across, and every session logged since has been outside it.

## Decisions taken here

**The column goes on `oura_daily_derived`, beside its siblings.** The table's name is Oura-shaped
but `training_load_ots`, `training_load_high` and `training_load_gate` already live there, so daily
training load is an established tenant. A new table would split one day's row across two places.
That is evidence from the schema rather than a preference.

**It rides the readiness persist rather than getting its own pillar.** `mergeDerivedPersists`
collapses same-day entries into one statement, and this is a readiness-read-path value — a second
push would be a second pillar name for one number nobody computes separately. Both halves of the
gate now land on one row, for one day, from the same computed values the gate itself read.

**No DEFAULT, and NULL is the honest value.** Zero is a *real* ACWR — the bottom of the range, a
genuine training state — so a default would enter later correlations as data. It fills forward
only; days before 282 stay NULL because nothing recorded them.

**Half-wired on purpose — and my first version of this was wrong.** I decided ACWR should be
purely server-side, on the reasoning that nothing on the device reads it. The full suite refused
that: `oura-daily-derived-sync.test.ts` has a drift tripwire asserting every `DERIVED_COLS` column
appears in the push payload, because **the device mirror is also the backup**, and its sibling test
records the real incident — `daytime_stress_coverage_min` and `chronic_stress_granular_nights` were
in `DERIVED_COLS`, the local mirror, the outbox and the fixture, and absent from `pushMutations`, so
a device's backup dropped them silently for as long as they existed.

So ACWR is in `DERIVED_COLS` and in the `pushMutations` branch: a device that sends it is honoured.
What is still omitted, now deliberately rather than by oversight, is the **device's local SQLite
table** — nothing there computes or reads it, so a device never sends it, the COALESCE upsert leaves
the server's value alone, and `applyDelta` ignores it on the way down. The cost is that a device
backup does not carry ACWR. That is acceptable for a **derived, recomputable** number in a way it
would not be for a raw measurement, and the reason is now a comment at the column map so the next
reader does not read it as a missed wire.

## Verification

`tsc` clean · `typecheck:tests` clean (318 errors / 89 files, none above baseline) · lint clean ·
Custom Rules **78 of 78** (after advancing the backlog's next-free-migration pointer to 284).

**The two TCP-only tests were run, and they are the ones that catch a missed twin:** 2 files,
**27 tests, all passed, none skipped** — the count CLAUDE.md documents. The generated twin's diff
against 281 is exactly one line, `t.acwr` on the `oura_daily_derived` view, and the owner's id does
not appear in it (checked by grep, per Q-456).

Mutation pass on the mapper chain — **3 mutants, 3 killed**, 1 equivalent control survived:

| mutant | outcome |
|---|---|
| `acwr` dropped from the column map (write silently no-ops) | killed, 3 of 4 tests |
| `acwr` dropped from the row mapper (read returns undefined) | killed, 4 of 4 |
| schema column pointed at a non-existent DB column | killed, 4 of 4 |
| *control:* the same map entry moved onto the previous line | survived, correctly |

That is the point of the round-trip test: a new column has to be in three separate places, and
missing any one of them still compiles and still writes. CLAUDE.md names this failure by hand — it
presents as *"the save doesn't persist"*.

## Not done

**Parts (b) and (c)** — widening the `phaseMode === 'automatic'` condition to reach `ai_dynamic`,
keeping `POST /api/confirm-early-deload` in the path. (b) is the behaviour change and is the next
entry off this queue.

**Nothing is back-filled**, so (b) should not be judged until the column has days in it.

**No device check, and none is owed** — this is a server-side write on a read path with no native,
safe-area or offline surface. The web sandbox exercises the same code the device does.

# 2026-08-19 — two admin routes no longer loop forever on a valid range (Q-497; Q-329 filed)

**Branch:** `fix/admin-range-loop-termination` · **Lane:** Implementation A

## The defect, which held exactly as filed

`admin/day-review` and `admin/backfill-derived-scores` both ran
`for (let d = start; d <= end; d = shiftDateStr(d, 1))`. That compares **strings**, and
`shiftDateStr` emitted an unpadded year — so one day after `9999-12-31` is `10000-01-01`, and
`'10000-01-01' <= '9999-12-31'` is **true**, because `'1' < '9'`.

Every guard passes on the way in for `from=9999-12-01&to=9999-12-31`: both dates normalise,
`end < start` is false, and the span is **31 — exactly `MAX_RANGE_DAYS`**. Each iteration is a
`buildDayAudit` at ~12 queries against a `max: 10` pool, and `backfill-derived-scores` **commits**
when `dryRun=false`, so it was an unbounded write rather than only a hang.

## The prescribed fix does not work, and that is the substance of this PR

The entry's fix was *"pad the year in `shiftDateStr` (`padStart(4,'0')`) — it fixes both call sites at
once and is the one-formula-one-place answer,"* with an iteration cap as optional belt-and-braces.

**Measured before building:**

```
current  9999-12-31 +1 = 10000-01-01
padded   9999-12-31 +1 = 10000-01-01     <-- identical
'10000-01-01' <= '9999-12-31' : true
iterations with the padded shift (cap 40): 41
```

`padStart(4, '0')` is a **no-op on a five-digit year**. It fixes the *lower* boundary — a year under
1000 emitting `999-01-01`, which sorts before `1000-01-01` — which is a real sibling malformation,
but it is not the reported hang. The "belt-and-braces" half was the load-bearing one.

**A `YYYY-MM-DD` contract cannot express a five-digit year**, so no formatting change makes string
comparison safe here. The fix belongs at the call site.

## What shipped

- **Both loops iterate the already-validated `span`** — `for (let i = 0; i < span; i++)` over
  `shiftDateStr(start, i)` — instead of comparing strings. `span` comes from `daysBetweenDateStrs`,
  which is millisecond arithmetic and correct at any year, and it is already bounded by
  `MAX_RANGE_DAYS` by the guard above each loop. **No string ordering is involved at all now**, so
  the class is gone rather than bounded, which is why this beats an iteration cap.
- **`shiftDateStr` pads the year to four digits anyway**, because the low-end malformation is real
  and one line. Its docstring now says plainly that this does *not* make the output safe to compare
  as a string, since that is the obvious wrong reading.
- **`app/api/admin/__tests__/range-loop-termination.test.ts`** — five cases, including one that
  asserts the **old** loop *fails to terminate* on the same input. That is deliberate: if someone
  later makes string comparison genuinely safe, that test goes red and gets read rather than
  quietly passing.

## A third finding, filed as Q-329

While measuring the low end: `shiftDateStr('0001-01-01', -1)` returns **`1900-12-31`**, not
`0000-12-31`. `Date.UTC` maps a year of 0–99 onto 1900+y, and padding cannot touch that. Reachable —
`normalizeDateParamIso` accepts any `\d{4}` — and `backfill-derived-scores` commits, so it would
write onto 1950s dates. Not folded in here: fixing it restructures the helper, and mixing that into a
termination fix would make the loop change harder to review.

## Verified

`npx vitest run app/api/admin/__tests__/range-loop-termination.test.ts` — 5 passed.
`packages/shared/src/__tests__/date-utils.test.ts` — 36 passed. Full unit suite with `DATABASE_URL`:
**501 files, 4,257 tests, 0 failed.** `npx tsc --noEmit` clean, `pnpm check:rules` **Ran 49 of 49**.

**Not exercised:** the routes were not driven end-to-end against a running server — deliberately,
since driving the old loop *is* the hang, and the iteration contract is what changed. Nothing on
device; no migration, no schema change, no auth or secret handling; admin-only surfaces, so no
user-visible change and no version bump.

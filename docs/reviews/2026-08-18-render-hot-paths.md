# Review — the rest of the render rules

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** render discipline, part 2
**Findings filed:** none · **Four rules audited, all held**

## Why

Sweep 26 audited memo stability (64 of 66 held; Q-490 filed) and listed what it had not covered:
Zustand selector breadth, timers in orchestrators, `readCacheSync` in a timer-rendering body, and
`key={index}` in editable lists. This is that list.

## 1. `key={index}` in editable lists — held

**85** `key={i|idx|index}` occurrences exist. The rule is narrower than that count:

> Rows in editable lists get a stable client id at creation, never `key={index}` — deleting a middle
> row makes the rows below inherit stale input state.

Filtering to lists that are **both editable** (an input / `onChange` in the row) **and deletable** (a
remove/splice/filter-by-index handler): **zero**. And the known editable lists use stable ids —
`saved-meals-sheet.tsx` keys on `meal.id` / `item.id`, `config-screen.tsx` on `style.id`, `s.id`,
`ps.id`, `program.id`.

**Reporting the 85 would have been wrong.** Index keys on a static list are correct React.

## 2. A 1 Hz timer in the orchestrator — held, and the code says why

`components/workout-screen.tsx:797` does contain a `setInterval`, in the file `CLAUDE.md` names as
the orchestrator. It complies:

```ts
// Writes only to the module singleton (never React state) so this 1 Hz tick can't re-render the
// orchestrator; the LiveHrChart leaves subscribe to it and re-render themselves.
const id = setInterval(() => { … recordTraceSample(cur.bpm); }, 1000);
```

`recordTraceSample` is a module-singleton write with no `setState`. The rule bans `setInterval`
**state** in an orchestrator, and this is the pattern the rule wants.

## 3. Zustand selector breadth — held

The orchestrator's `useShallow` pick is **62 fields**, which looks alarming and is not. The hot-path
*values* the rule names — `perSetWeights`, `rpeValues` — are **absent** from it; what is picked is
their *actions* (`updatePerSetWeight`, `initRpeValues`, …), and Zustand action references are stable,
so they cannot cause a re-render.

The leaves read the values themselves, exactly as prescribed:

```
active-set-card.tsx:40   useWorkoutStore((s) => s.perSetWeights[currentSet])
active-set-card.tsx:44   useWorkoutStore((s) => s.rpeValues?.[currentSet])
sets-grid.tsx:30,33      useWorkoutStore(useShallow((s) => s.perSetWeights / s.rpeValues))
```

**Counting fields in a `useShallow` pick is not the test.** Actions vs values is.

## 4. `readCacheSync` in a render body — held, and the grep flagged the rule itself

A scan for `readCacheSync` outside an effect/callback returned 25 hits, three of them in the
orchestrator (which has a timer). All three are false positives, and the first is instructive —
`workout-screen.tsx:264` is a **comment**:

```
// One-time read, not a render-body cache read — this orchestrator re-renders on
// every store update, and readCacheSync must never live in that path.
```

The grep matched the prose stating the rule and reported it as a breach of the rule. The other two
(`:329`, `:335`) sit inside a callback that opens further above than the heuristic's backward window.

## Result

**All four rules hold.** Combined with sweep 26, the render section is in good shape: 64 of 66 memos
stable, hot-path store reads in leaves, the orchestrator's timer writing a singleton, editable lists
keyed by id. The one open item is Q-490.

## The standing lesson, sixth consecutive sweep

Every mechanical check in this sweep over-reported, and one of them flagged the comment that states
the rule it was checking. **The grep finds candidates; the handler decides.** In this codebase the
raw counts — 85 index keys, 62 picked fields, 25 bare cache reads — are all defensible, and a review
that filed them would have produced three wrong entries and one absurd one.

## Not verified

Static analysis, no profiler. Not on the APK. The editable/deletable classifier reads a ±40-line
window around each `key={index}`, so a very large row component could be misjudged; the 85
occurrences themselves are exhaustive.

# 2026-09-15 — Retraction: BF-165 never reproduced, and a cold route looks exactly like a dead tap

**Branch:** `docs/bf165-retract-harness-repro` · **Lane B** · docs-only

Two journal entries earlier today reported that BF-165 reproduces in the Playwright harness, that
*Guided walk* is a second dead button the owner had not reported, and that the failures share the
`/activity` prefix.

**All three are wrong.** The cause was `next dev` compiling the route on demand.

## The control I never ran

Warm the destinations first — `goto('/activity/guided-walk')`, then `goto('/activity')` — then return
to `/cardio` and tap *Guided walk*:

```
WARM after-tap path: /activity/guided-walk
WARM rsc reqs: [".../activity/guided-walk?_rsc=oIyhzzLHhOWICEm7"]
        res:  ["200 .../activity/guided-walk?_rsc=oIyhzzLHhOWICEm7"]
```

It navigates. The RSC request returns 200. Every "dead tap" I measured was a **cold route**.

## Why it was so convincing

`next dev` compiles a route the first time it is requested. A client-side `router.push` issues an RSC
fetch, and that fetch **hangs until compilation finishes**. Measured on the cold run: the
`/activity/guided-walk?_rsc=…` request was still unresolved after 8 s while two sibling `/api/*` calls
on the same page returned 200.

Nothing throws. No 4xx or 5xx. No console error. No failed request. The URL never changes, because
Next only commits on response.

**That is byte-for-byte the signature of the bug I was looking for** — including the "fails silently,
which is why `error_events` has nothing" reasoning, which I offered as corroboration and which was
just as true of a compile stall.

## What each earlier claim actually was

| claim | reality |
|---|---|
| "Reproduced in the harness — not device-only" | It does not reproduce. The entry's device gate was right and I overrode it. |
| "*Guided walk* is a second dead button" | **A fabricated defect.** Guided walk works. |
| "Both failures share the `/activity` prefix" | `/running` simply compiled faster than `ActivityScreen`'s tree inside the same 5 s wait. |
| "The sheet's `history.back()` is not the cause" | Unproven — that experiment also ran cold, so it established nothing. |
| "`/activity` serves 200 on a direct visit" | Still true; a direct `goto` compiles synchronously before returning. |

## The rule this leaves behind

**Warm the destination with a direct `goto` before measuring any client-side push to it.** Without
that, *"the navigation did not happen"* carries no information — and no fixed wait is safe, because
the compile time scales with the tree behind the route.

I had been running controls all day for the *fix* — does the assertion fail without the change — and
that discipline caught three vacuous tests. I did not run the control for the *harness*: does the
happy path work here at all. A dev server that compiles on demand makes "it didn't work" the default
answer for anything not yet visited.

The tell was available and I read past it: the very first probe returned `RSC unresolved: 1` — a
request with no response. An unresolved request is a pending one, not a failed one, and pending means
*waiting on the server*, which is the thing a fresh dev route always does.

## Where BF-165 stands

Back where the entry had it: **device-gated, cause unknown, three candidates open.** The source-path
elimination table at the top of that entry is unaffected — it came from reading, not from the harness.

Three PRs (#1227, #1230 and their journal entries) carry the retracted claims; this entry and the
retraction block on the backlog entry are what correct them. The entries are left in place rather than
rewritten, because the sequence is the lesson.

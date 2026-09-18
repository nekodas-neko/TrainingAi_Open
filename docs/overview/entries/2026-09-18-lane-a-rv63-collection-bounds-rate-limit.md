# 2026-09-18 — RV-63: the only unbounded route, narrowed and limited — but not floored

**Branch:** `lane-a/rv63-collection-bounds-rate-limit` · **Lane A** · no migration · unversioned

## What the entry found, all verified

`/api/collection` pins `HISTORY_START = '2000-01-01'`, issues five parallel all-history reads, has
**no rate limit** (`grep -c 'rateLimit('` → 0), and the home card re-fetches it on every paint —
`cachedFetch` revalidates regardless of TTL (Q-262). Two of the reads were full-width for one field
each: **36 columns** of `body_metrics` and **25** of `sleep_sessions`, immediately projected to
`.map(x => x.date)`.

## The half I did not take, and why

The entry prescribed *"a date floor and two projected selects."* **The date floor is not taken**, and
the route's own comment already said why: *"The collection is a replay over ALL history, so there is
no window to bound the reads with."* `replayCollection` walks every recorded day forward from the
beginning, so a floor silently changes what the ladder reports for anyone with history behind it —
a behaviour change wearing a performance fix's clothes.

The growth the entry is right to worry about is real, and narrower rows address it honestly: the
reads went from 176 and 144 bytes a row to one `date` column, so the width no longer grows with the
schema. Seeing less history is not the same fix as reading less per day.

## The rate-limit norm, decided rather than matched

The entry flagged that there is no sibling norm to appeal to, and left it open explicitly:
*"Decide the norm once rather than matching whichever sibling is read first."*

Checked, and the entry is literally right — the split tracks nothing. `weekly-muscle-sets` has **five**
repo calls and no limit; `muscle-tonnage-trend` has two and none; `weekly-review/month-window` and
`oura-ble/rollup-state` have one each. Call count does not predict it.

What does separate them: **every one of those routes is windowed, and `/api/collection` is the only
route in `app/api` that reads all history.** So the rule established here is about the read rather
than the folder — *an unbounded replay gets a limit; a windowed read does not* — and it has no
counter-example in the codebase, because there is no other unbounded route. 30 per 60 s, matching
`weekly-review/month-window`, the nearest aggregate in shape.

That is a rule stated for one route on a stated principle, not a norm retro-fitted onto six.

## Two route tests changed, and that is the part to read

Pushing the `> 0` predicate into SQL took it out of the route's reach. Two existing cases asserted
that a **low** day still spawns a cat — 400 steps, 3.5 hours — which encodes a measurement: only 35
of the owner's 130 step-days reach 8,000, so a threshold would decay the steps ladder most weeks.

The route can no longer prove that, because it no longer sees the value. **The guarantee moved with
the code rather than being dropped**: `lib/data/postgres/__tests__/rv63-collection-day-keys.test.ts`
asserts it against a real Postgres. What the route test still proves is narrower and true — it spawns
one cat per day it is given and invents no bar of its own.

Editing a test to go green is normally the signal that behaviour changed. Here behaviour did not
change, only its location, and the replacement is stronger: the old assertion ran against a mock
returning whatever it was told, and the new one runs against the SQL that now owns the decision.

## Verification

| suite | result |
|---|---|
| `lib/__tests__/collection-route.test.ts` | 10 passing |
| `lib/data/postgres/__tests__/rv63-collection-day-keys.test.ts` | **8 passing** (new) |

Mutation pass on the moved predicate — drop `gt(..., 0)` from both reads and **exactly the four
"drops" cases fail**. The four survivors are the controls: a low step count and a short night must
*not* be dropped, the `from`/`to` bounds must still apply, and another user's rows must not appear.

Two fixture bugs, both mine, both fixed rather than worked around: `sleep_sessions` has `sleep_start`
**and** `sleep_end` NOT NULL, so a night fixture carries a window even when only the duration is
under test — and that window is deliberately not derived from the duration, because these cases are
about the stored column rather than anything recomputed from the timestamps.

Gates: Custom Rules, `tsc --noEmit` with the real exit code, `check-test-typecheck`, and the full
suite before committing.

## Not exercised

- **The S25 device.** Server-side only; reaches the phone through a Railway deploy with no APK.
- **The rate limit against a real client.** 30/60 s is generous for a home card, but nobody has
  navigated the app hard enough to see whether a legitimate burst reaches it — the failure mode would
  be a 429 on a card that otherwise paints.
- **The width saving, measured.** The column reduction is arithmetic from the schema, not a timing.
  The entry was explicit that nothing is slow today and this is filed as growth, not latency.

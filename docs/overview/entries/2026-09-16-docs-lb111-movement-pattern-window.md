# 2026-09-16 — `docs/lb111-movement-pattern-window`

Backlog only. No product code.

**OR-118 was unparked as startable Lane B work four hours after being split out of Q-305, and it is
not startable: the number it renders cannot be fetched by any client today.** Filed the engine half
as **LB-111** (Lane A) and parked OR-118 on it.

## What the entry claimed, and what is actually true

OR-118 said: *"`components/health/` (the Training surface), reading shared helpers only. No storage,
no derivation change: every number it renders already exists."*

Half of that holds. The **grouping** exists — `movementPattern()` shipped as LB-103 on 2026-09-13,
and a grep shows it has **no callers at all**, so this card would be its first. The **numbers** do
not. The measurement in the entry — *legs 481 · push 433 · pull 333 · other 168 over 60 days* — came
from a direct query. Checked rather than assumed, every route that could serve it:

| route | window |
|---|---|
| `GET /api/weekly-muscle-sets` | `GET()`, no params — computes this Monday server-side |
| `GET /api/ai-periodization/weekly-volume` | same, `startOfWeekInTz(tz)` + 6 days, hardcoded |
| `GET /api/muscle-tonnage-trend` | 6 weeks, but **tonnage, not sets** |
| `grep -rn '60.*day' app/api/*/route.ts` | nothing |

**Tonnage is not a substitute and using it would have been the wrong kind of shortcut.** Legs move
far heavier loads, so a tonnage share overstates them — it would hide the pull-set deficit the card
exists to surface, under a label claiming to show set balance.

## Why this is Lane A's half first

The derivation is already windowed:
`getWeeklySetsByMuscleGroup(userId, programId, weekStart, weekEnd, tz)` takes **arbitrary** start and
end dates in spite of its name. Every caller throws that away. So what is missing is an **exposure**,
and a route under `app/api/**` is Lane A's by the path rule — *both halves → Lane A, engine half
first*. Building the card first would mean either a Lane B route (a lane violation) or a card that
silently renders one week and calls it a balance.

**One real design question goes with it**, which is why LB-111 is not a one-liner: the method scopes
to a single `programId`, and a 60-day window can span a programme change, so sets logged under a
previous programme either count or vanish. Recommended counting them — the card's claim is about the
lifter's training balance, not one programme's adherence — but it is a genuine choice and the answer
belongs in the route.

## The lesson, which is the third of this shape in two days

An entry's statement about **what data exists** is prose until something checks it, exactly like its
recommended fix and its plan. BF-167's recommendation would have reddened BF-8's guard; BF-5's plan
told PR 2b to keep a param the route cannot honour; OR-118 says every number already exists and one
of them does not. All three were caught by reading the thing the entry pointed at rather than the
entry — and in this case by a grep for `movementPattern` callers, which returned nothing and made
the "already exists" claim checkable in one command.

**Not a criticism of the split**, which was right: the build genuinely was hiding inside a `Keep:`
with an inline gate, and finding it was the hard part. The premise it inherited came from Q-305.

# 2026-08-26 — My Foods put two different things in one list

**Branch:** `fix/my-foods-split` · docs-only · BugFix Intake

## The report

*"my foods combined saved meals + history thats not right they are 2 seperate things."* — on
v1.382.0, which is Q-395c.

## The distinction worth stating, because it is not a change of mind

Q-395c was specified from the owner's own earlier question: *"So im picking up a discrepancy between
My Meals and My foods? Whats the difference"*. That was read as *these are one list wearing two
names*, and the merge followed.

Re-read against today's report it says something narrower: **two lists with confusingly similar
names, and no way to tell which held what.** The fix was to name them so the difference is obvious.
It was not to delete one of them.

They are genuinely different kinds of thing:

| | Saved meal | Food item |
|---|---|---|
| What it is | a composition — ingredients, a batch, a per-portion figure | one ingredient with a serving size |
| How it got there | you assembled and saved it | it appeared because you logged it once |
| What logging it means | log the whole thing | pick a quantity of one thing |

A composed recipe and a raw ingredient in one list makes *"log this"* ambiguous on every tap.

**BF-37** therefore reverses the merge and **keeps three things Q-395c got right**, so it is not
reverted wholesale: the naming sweep, `food-list.tsx`'s two-source design (its own journal says a
food row and a meal row already open different destinations — the separation exists inside the
component), and LB-17's three-deep back-dismiss fix, which is unrelated and hard-won.

## The bug in the same screenshot that was not reported

`LOADED MAC & CHEESE / CORE POWERFOODS / 350 g` appears **twice** in a 24-item list. Measured against
production:

| Measure | Value |
|---|---|
| `food_items` rows | **209** |
| Distinct name + brand | **190** |
| **Redundant** | **19 — 9%** |
| By source | `ai` 14 names / 32 rows · `barcode` 1 / 2 · `text` 0 |

Filed as **BF-38**, Lane A's #1. Two things make it worth fixing now rather than tolerating:

- **It multiplies BF-35's spend.** Three rows for one mac and cheese is three generated images, three
  stored copies, and three different-looking pictures of one product in a single list.
- **It corrects this session's own measurement.** The "209 food items" behind BF-35's storage
  estimate is really **190 foods and 19 accidents**.

The entry says explicitly **not** to clean up history with a merge migration in the same change:
`food_logs.food_item_id` is `ON DELETE RESTRICT`, so collapsing duplicates means re-pointing every
log at a survivor, and a wrong matching rule rewrites what the owner ate. Stop the creation, live
with the 19, decide de-duplication separately once the rule is shown correct on new writes.

## Also confirmed

**BF-34 shipped** — `2026-08-26-sibling-sheet-back-dismiss.md`. The delete fix is on `main` and
carries `Gate: device`; it needs the owner to press it.

## A logged meal stops being a meal (BF-39)

Owner: *"the meal is a complete in 'saved meal' and it can have a picture etc. but when adding it to
the log; its broken down into its components so the image wont transfer over ... maybe it needs to
stay as a whole item."*

Right, and the missing piece was already written down as a *different* problem. Logging a saved meal
writes one `food_logs` row per ingredient and **nothing records that they came from a meal** —
`food_logs` has `food_item_id` and no `saved_meal_id`.

**Three symptoms, one cause:**

| Symptom | Where it surfaced |
|---|---|
| The meal's photo cannot follow it into the diary | this report |
| A saved meal has **no last-used timestamp at all** | Q-395c's journal, filed as a constraint |
| The diary shows five ingredients where one thing was eaten | implied by both |

Q-395c's journal says it outright — *"True MRU needs a column that does not exist — Lane A's to
add."* That is this column, and adding it for ordering alone would under-sell it.

**Recommended: stamp the ingredients, don't change the row shape.** A nullable `saved_meal_id` plus a
per-log group id is additive; the diary groups rows that share it and renders the meal's name and
photo over them. The alternative the owner reached for — one row for the whole meal — makes the diary
trivially correct and costs a **second shape** in a table read by the diary, the energy balance, the
adaptive-TDEE window, the sync delta and the local store, and it makes editing one ingredient
impossible without decomposing anyway.

**The owner's phrasing asks for the outcome, not the storage.** "Stay as a whole item" is satisfied by
the diary *showing* one grouped item, which the additive option delivers.

## The DEXA scan is tomorrow — what is and is not ready

**BF-33 shipped.** `measured_rmr` exists (`schema.ts:774`) with `POST /api/measured-rmr`, bounds
checking, and — the load-bearing column — `ffm_kg_at_test`, so the measurement can be re-scaled to a
future body instead of expiring on a date. **There is no UI yet**: `grep` finds no `.tsx` referencing
it. Entry is a route call, not a screen.

**BF-2 has not shipped.** No `dexa` anywhere in the tree. The DEXA half has nowhere to go.

**So the operational note went into BF-2, because one part of tomorrow is irreversible.** The owner
identified it themselves: *"Will need to get the dexa matched with the same days renpho scale
measurement."* The scale reading is one half of the calibration pair and cannot be reconstructed
later — while the DEXA numbers can be entered any time, since the record is dated by when it was
measured rather than when it was typed.

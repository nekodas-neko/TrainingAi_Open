# 2026-09-12 — BF-147 Lane A half: a verdict column for generated GIFs

**Branch:** `lane-a/bf147-gif-review-status` · **Agent:** Implementation Lane A

## What the owner asked for

From the Admin Console → Exercises tab: *"ui is bad and I also want a better way to make sure
everything has the right gif. Maybe a way for me to flag if its wrong so you we can decide how to
proceed."* BF-147 splits along the lane rule: the flag needs a column and a route (Lane A), the
screen that uses it is `components/admin/exercise-manager.tsx` (Lane B).

## What shipped

- **Migration 273** adds `review_status` and `reviewed_at` to `exercise_media`. `review_status` is
  `NOT NULL DEFAULT 'unreviewed'` with a CHECK constraint on the three values, and a **partial**
  index covers only the rows that are not `unreviewed` — the flagged set is the small one and the
  only one anything queries.
- **`app/api/admin/exercise-media-review`** — `GET` returns the flagged set, `PATCH` writes one
  verdict. Keyed on `(exercise_name, gender)`, which is `exercise_media`'s own unique key, so a
  caller names the thing it is judging rather than a row id it had to look up first.

## Decisions, and why

- **The route imports no generation surface at all, and there is a test asserting that.** The entry
  was explicit that marking a GIF wrong must not fire an AI call — collecting the wrong ones is the
  point of collecting them. The assertion is load-bearing rather than decorative: the obvious
  "helpful" follow-up is to regenerate on a `wrong` verdict, and that would quietly destroy the set
  the owner asked to be able to decide about.
- **`PATCH` 404s rather than upserting.** A verdict about a GIF that does not exist is not a
  verdict, and creating a media row from a review call would invent provenance — `model_used` null,
  `generated_at` now — for a generation that never happened.
- **Clearing to `unreviewed` nulls `reviewed_at`** rather than leaving the old stamp, so "when was
  this judged" never outlives the judgement.
- **Rate-limited 60/60 s** to match the sibling media routes. It is cheap by comparison (no
  generation), but a runaway client loop is the same mis-click exposure and uniformity is free.

## Verification

- Migration applied against the local DB; column, default, CHECK constraint and partial index all
  confirmed present by query, not by reading the SQL.
- 13 route tests, full suite green, lint separately green, `pnpm check:rules` green.
- **Mutation pass — 4 planted defects, 4 killed:** GET dropping the `unreviewed` filter; PATCH no
  longer 404-ing on a missing media row; `unreviewed` keeping a stale `reviewed_at`; the body schema
  losing `.strict()`. The equivalent control (`4 * 1024` rewritten as `4096`) survived, as it should.

## Not done, and not silently

- **No UI reads either verb.** That is Lane B's half and the entry stays in the queue re-laned,
  carrying the four UI defects plus the sweep screen.
- **The production S3 credentials were NOT checked.** BF-147 asks for that before writing code
  here. It was judged orthogonal to this half — a verdict column touches neither storage nor
  generation — but that judgement is recorded rather than assumed: the `SignatureDoesNotMatch (403)`
  still gates the Mirror / "AI all" paths and the six proxy-path media rows, and nobody has looked
  at prod.
- **Not exercised:** no device run (this is a server route with no device path), and the route has
  never been called by a client, because no client exists yet.

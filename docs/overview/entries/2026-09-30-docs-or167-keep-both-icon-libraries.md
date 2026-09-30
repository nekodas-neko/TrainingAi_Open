# 2026-09-30 — OR-167 was answered "keep both", so it leaves the queue without code

**Branch:** `docs/or167-keep-both-icon-libraries` · docs-only, no version bump

`OR-167` proposed dropping `@phosphor-icons/react` and moving its five glyphs onto lucide. **The
owner answered on 2026-09-30: keep both — against the recommendation.** He declined to change icons
on screens he reads *mid-run* for a dependency saving, and the size numbers were put to him when he
decided, so the measurement is not a reason to re-ask.

That leaves nothing to build. Per CLAUDE.md — *"if it's superseded or already done, remove the
backlog entry via a docs-only PR with a one-line note on why, instead of forcing a mismatched
implementation just to clear the queue"* — it is removed rather than implemented.

## Re-verified before writing the note that outlives the entry

The entry's figures are from 2026-09-25 and still hold on `main`:

- `lucide-react` — **276** importing files (the entry said 270).
- `@phosphor-icons/react` — **six**: five under `components/activity/**` plus
  `packages/shared/src/constants/activity-icons.ts`.

## The consequence, written where it will be hit

The decision leaves a real gap the entry named itself: **two icon sets ship and nothing says which
to reach for.** A closed backlog entry is not where a future contributor looks, so that went into
[`docs/module-map.md`](../../module-map.md) — which exists to answer "what already exists and where"
before new work starts — as a row saying lucide is the default, phosphor is frozen to those six
files, and swapping one of the five is a **look change on a daily screen** needing a 384 px
before/after and his yes, not a cleanup.

If the two-set inconsistency ever becomes a real problem, that is a new entry about consistency, not
a re-run of this one.

## Verified

`check-backlog-pointers` **521 entries, OK** · `check-doc-index-size` OK. No code changed.

---

# Also here: BF-183 routed, because it named its own lane wrong

With `OR-167` cleared, `BF-183` became the Lane B head. **It is not buildable here**, and the entry
says so in its own body — *"this is a schema change and therefore Lane A's to land"* — while
carrying `Lane: B`.

That is the shape CLAUDE.md warns about outright: **the lane field routes work and prose does not.**
The engine half would have sat in Lane B's queue until someone read the paragraph. Split into
**`LB-199`** (Lane A: the stored `suitableMealTypeIds`, its local-SQLite mirror, and the history
seed), with `BF-183` keeping the render half and parked on it via `Needs:`.

Both entries ride in this PR rather than a second one, for the reason the filing-sweep rule gives:
two docs-only PRs editing `docs/implementation-backlog.md` minutes apart is a conflict waiting to
happen, and neither is a code change.

## The open question it left for the implementer, answered by reading the file

`BF-183` asked whether the affinity is computed server-side or client-side and said to
**"decide by checking what `saved-meals-sheet` already fetches"**. Checked:
`components/nutrition/saved-meals-sheet.tsx` fetches exactly two things — `saved-meals` and
`nutrition-meal-types` — plus a local-first `store.getSavedMeals()`. **It holds no log history at
all.** So client-side is not a trade-off, it is a new fetch on a screen that does not want one:
**server-side, on the saved-meals payload.**

That read also surfaced something the entry did not say: the sheet is **local-first**, so the local
SQLite mirror is not optional. Without it the tags vanish offline on a list that otherwise works
offline — the offline-first inversion CLAUDE.md names as a recurring bug class.

## A contradiction inside the entry, reconciled

`BF-183` was answered *"LUCIDE ICONS, not the emoji — against the recommendation"*, and its body
still argued at length for the emoji, ending **"still the recommendation: use the meal type's own
emoji."** Struck, with the reasoning kept visible so the next reader learns it was already argued
rather than re-opening it.

What survives the strike is the **risk**, which is now the build's acceptance test rather than an
argument: a row may show four glyphs at once, in a vocabulary he has not been trained on, at a row's
icon size. And one thing the answer leaves genuinely unsolved — **lucide has no glyph for a
user-created meal type**, where the user-set emoji always did. This account has carried an
*"Afternoon Meal"*. The fallback has to be decided before building rather than discovered when a
type renders nothing.

## Lane B READY is 0 after this, and that is a real state

Three head items, three different outcomes: `OR-206` shipped (#2027), `OR-167` decided against a
build, `BF-183` is engine-first and now Lane A's. None of them was buildable here today.

## Verified

`check-backlog-pointers` **522 entries, OK, no cycles, all `Needs:` targets known** ·
`check-doc-index-size` OK · `next-item.js` confirms `LB-199` in Lane A and `BF-183` parked on it.
No code changed.

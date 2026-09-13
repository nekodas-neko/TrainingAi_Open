# 2026-09-12 — BF-147: the admin Exercises tab, and a stated cause that measurement overturned

**Branch:** `fix/bf147-admin-exercise-manager` · **Lane B** ·
`components/admin/exercise-manager.tsx`, `components/admin/gif-review-sweep.tsx` (new).

Owner, on the Admin Console → Exercises tab: *"ui is bad and I also want a better way to make sure
everything has the right gif. Maybe a way for me to flag if its wrong so we can decide how to
proceed."* Lane A's half — migration 273 and `/api/admin/exercise-media-review` — landed the same
day and nothing read it.

## The unreadable name is the action row, not the badge

The entry's diagnosis: `SourceBadge` has no `shrink-0`, so the name is the only flex item that can
give and it gives everything. Measured at 412 dp against the running app before changing anything:

| part of the row | width |
|---|---|
| thumbnail | 40 px |
| **flexible column (name + equipment)** | **50 px** |
| status glyph | 14 px |
| **the four action buttons** | **204 px** |

The badge is **25 px**. The row is 340 px of content. **The action group is 60% of it**, because
`globals.css`'s 48 dp tap-target floor inflates each 12 px icon to 51 px — so the name got **19 px**
of the 87 it needed, and the `bod…` in the owner's screenshot was line two surviving in the same
50 px. Fixing the badge would have moved nothing.

Shrinking the targets is a P0 violation and an overflow menu costs a tap on every action, so **the
row goes to two lines**: identity on top, actions right-aligned beneath. Re-measured after: every
name renders in full — Arnold Press 19 → 87 px, Barbell Bench Press 139 px, nothing clipped — and
the delete button is still 48×48.

That is **five entries in a row** whose stated cause did not survive contact with the code.

## Three destructive taps, one confirm

`ConfirmDialog` already existed. Delete fired on a single tap — BF-124's defect in a second place,
four days after the owner lost a session to an unconfirmed trash icon — and had **no accessible
name at all** while Edit beside it did.

The subtler pair: the per-row Mirror and AI buttons pass `force = hasS3Gif`, so on a row that
already has a GIF they replace it with no prompt and no undo. The *bulk* buttons skip such rows, so
the dangerous control was the one that looks incidental. They now confirm **only when they would
overwrite** — verified both ways: a no-GIF row (Cable Row) mirrors on one tap with no dialog, a
with-GIF row (Abs) asks first.

**Verified from the database rather than from request interception, and that correction matters.**
My first probe intercepted the DELETE and reported "no request fired" after confirming, which I
briefly read as the confirm being broken. It was the probe: `count(*)` went 146 → 145, so the
confirm had fired a real delete all along. Cancel left the row in place. The row was restored from
the migrations' own values (`007`, `030`, `036`), and the counts are back to 146/145.

## Coverage counted the wrong thing twice

`withGif / exercises.length` put merged-away rows in the denominator (they stay in the shared
catalogue on purpose, so full coverage was unreachable by construction) and counted only
`exercise_media` in the numerator — so a Custom URL from `exercise_gif_cache` drew a thumbnail on
the row and still read as uncovered, from the very source `getThumbnail` falls back to.

Locally `40 / 146` → **`42 / 145`**, and both halves match `count(*)` exactly. The list itself still
shows merged rows — an admin editing the shared catalogue needs to see them — so it now says so
rather than leaving two counts that disagree and look like a bug.

## The sweep

`gif-review-sweep.tsx`: one GIF at a time, 300 px, name and target muscles beneath, two buttons.
The queue is the live exercises with a media GIF and no verdict yet; it advances **only** on a
successful PATCH, because skipping past an unrecorded verdict is how a sweep ends up claiming
coverage it does not have. `unoptimized` on the image is load-bearing — `/_next/image` would serve
a still frame, and a still frame cannot answer whether the movement is the right one.

Driven end to end: opened at "Reviewing 1 of 40", judged one Wrong and one OK, and both landed in
`exercise_media` with `review_status` and `reviewed_at` set. Reopening showed **38 unreviewed · 1
flagged wrong**, so the already-judged filter works off the route's own GET.

Nothing regenerates. *"So we can decide how to proceed"* asks for a set to decide about, and
regenerating on the spot would destroy the evidence of what was wrong.

## Verification

`pnpm check:rules` **Ran 73 of 73** · `tsc --noEmit` and `eslint` clean · `pnpm test` **890 files /
8411 tests / 0 failed** by real exit code, with `DATABASE_URL` set so the ~190 DB-backed files
actually ran (700 without it) · `pnpm build` exit 0. Rendered, measured and driven in Chromium at
412×915 against the local database.

**The local database was mutated to reach this screen and has been put back**: `is_admin` on the
seeded user (flipped, then restored, and the auth storage state re-minted non-admin), 40 probe
`exercise_media` rows (deleted — the table is empty again), the two verdicts (gone with them), and
the deleted exercise (restored).

**Not exercised.** The S25 — this is a harness measurement at 412 dp, not glass. And **the
production S3 credentials, which the entry asked to check before writing code here**: the sandbox
boot banner reports `SignatureDoesNotMatch (403)` from the shared client. Judged orthogonal — none
of this touches storage or generation — but it still gates "AI all"/Mirror and the six proxy-path
rows, and it remains the one thing BF-147 owes.

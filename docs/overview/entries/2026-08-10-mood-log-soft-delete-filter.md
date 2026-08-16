# 2026-08-10 — the server and the device disagreed about deleted mood logs (Q-178)

**Branch:** `fix/mood-log-soft-delete-filter` · **Domain:** `platform`, `readiness` · no version
bump (no user-visible change — the column has no writer yet)

`mood_logs` carries `deleted_at` on the server **and** in the local SQLite table, and
`lib/local-store/sqlite-backend.ts` filters on it. The server's user-facing reads did not. The
device would hide a deleted mood log; the server would hand it straight back.

Latent, not live: nothing server-side writes that column today. Fixed anyway, on the owner's call,
because whoever adds mood-log deletion would land on a server that already returns deleted rows —
and *"the mood I deleted came back after a sync"* reads as a sync bug, not a missing predicate.

## The entry said three reads. Two was correct.

Q-178 was filed as *"add `isNull(s.moodLogs.deletedAt)` to the three reads"*. Applying that
literally would have introduced a bug.

The third read is inside **`getSyncDelta`**, and it is not the same kind of read as the other two.
It is the **tombstone channel**: a delta that hid deleted rows could never tell a device that a row
went away, so the delete would not propagate — precisely the failure CLAUDE.md's sync rules exist
to prevent. `food_logs`, the domain that already has working tombstones, is unfiltered in
`getSyncDelta` for exactly this reason, and that is what settled it.

So: the filter goes on `listMoodLogs` and `getMoodLog`; the sync read keeps a comment saying why it
must stay unfiltered, and a test holds the two apart.

## Verified

Both directions are mutation-tested, which is what makes the distinction above load-bearing rather
than a claim in a comment:

| mutation | result |
|---|---|
| remove the filter from the two user-facing reads (the original bug) | *"a deleted mood log is hidden from both user-facing reads"* **fails** |
| **also** filter the sync read (the plausible over-fix) | *"but the sync delta still emits it, because that is the tombstone"* **fails** |

Against the running dev server, end to end: a mood log present via `GET /api/mood` → stamp
`deleted_at` → `GET /api/mood` returns **`null`** → `GET /api/sync/pull` **still carries the row,
with `deletedAt` set**.

- `/`, `/health`, `/nutrition`, `readiness-score`, `day-timeline` all 200; no errors in the dev log.
- `tsc --noEmit` clean · **434 files / 3457 tests** green · all 19 custom-rule scripts pass · eslint
  clean on the touched files (11 warnings, all pre-existing unused imports).

## Worth stating

The two new tests stamp `deleted_at` **by hand**, unlike every other test in that file, which
deletes through a real repository method. That is not a shortcut — **there is no `deleteMoodLog` to
call.** The column exists with no writer, which is the finding restated: this change makes the reads
ready for a delete path that does not exist yet.

## Not exercised

- **Any actual mood deletion**, because there is none to run. The filter is verified against a
  hand-stamped `deleted_at`, so what is proven is that the reads honour the column — not that a
  future delete flow is correct end to end.
- **The APK.** The local store already filtered this column before the change, so the device side
  is unchanged by definition; the point of the work was to make the server agree with it. Not
  observed on-device.
- **Cross-device propagation.** The tombstone is proven to *leave* the server in the delta. Whether
  `applyDelta` removes a mood row on the receiving device was not exercised — nothing writes the
  column, so there has never been one to receive.

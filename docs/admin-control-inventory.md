# The admin control inventory (OR-115)

Owner's ask, 2026-09-14: *"I'd like to re-organize all the buttons and options we have in the admin
section to only use what we actually need as well."*

This is the inventory OR-115 requires **before** anything is hidden or deleted. It is the list, grouped
by what each control is *for*, with a recommendation per row. The keep/hide/delete call is the owner's.

**Decided 2026-10-05 and built in #2379 (#2250):** the owner accepted the three strong recommendations
and kept both open ones visible. Settings → Developer now groups section A under three headings —
**Checks** (model assets first, then time audit and program export), **Heart-rate backfills** (both),
and **One-off repairs**, where the exercise unit fix sits collapsed. Nothing was deleted. The
set-HR backfill's code header no longer calls it a one-off.

---

## Finding 1 — "the admin section" is TWO screens, and that is most of the problem

There is no single admin surface. Controls live in two places with different access rules:

| Screen | Gate | What is on it |
|---|---|---|
| **`/admin`** | admin-only | 6 tabs: users · invites · exercises · activities · feedback · devices |
| **`/more/settings/developer`** | Settings → Developer | 3 diagnostic rows + **6 bare maintenance cards** |

The split is deliberate and documented: `developer-content.tsx` records that the three device consoles
were moved to `/admin` → Devices under `Q-531`, *"because a drain or a re-sync is destructive in the
wrong hands and access control outranks the taxonomy"* — with an explicit *"Do not re-add a device row
to this screen."* That reasoning holds and nothing here proposes undoing it.

**But it means a search for "the admin buttons" finds half of them.** The six maintenance cards the
owner is most likely thinking of — backfills, a unit correction, an export — are on the *Developer*
screen, not `/admin`.

## Finding 2 — nothing is unreachable, so *delete* is never justified on dead-code grounds

Every component in `components/admin/` resolves from a live import: checked by **export name** across
`app/`, `components/` and `lib/`, all 19 reachable.

⚠ **A path-shaped grep got this wrong first.** Matching `admin/<file>` reported
`hr-backfill-card.tsx` as *"NOT IMPORTED ANYWHERE"* — it is the shared base that both
`set-hr-backfill-card` and `workout-hr-backfill-card` import as `./hr-backfill-card`. A relative
import has no `admin/` in it. **The reachability column below is by export name; do not re-derive it
from a path grep** (OR-187).

So this is a *too many live controls* problem, not a dead-code cleanup. That is evidence for the
entry's own rule — **do not start by deleting** — rather than a reason to override it.

## Finding 3 — the axis the code can answer, and the one it cannot

OR-115 says the useful axis is *how often the owner actually reaches for each control*, and that
**is not visible from the code**. It is not guessed here.

What the code *does* answer is each control's **nature**, which is what makes a keep/hide/delete
recommendation arguable at all:

- **Diagnostic** — reads only, answers a question. Safe to keep; cheap to hide behind a disclosure.
- **Remedy** — writes, re-runnable, needed whenever a condition recurs. Must stay reachable.
- **One-off correction** — writes, applied once against historical rows. The hide candidate.

⚠ **Two cards are labelled "one-off" in their own headers and are not.**
`set-hr-backfill-card` says outright: *"'New workouts populate automatically' is only true if the
recap is opened … so re-running this is the remedy whenever a workout ends without its recap being
viewed."* That is a standing remedy for a live gap, not a migration. Its header's own first line still
reads *"One-off admin utility"*. **Read the body, not the label.**

---

## The inventory

### A. `/more/settings/developer` — the six bare cards

These sit **below** a labelled `Diagnostics` group with **no group heading of their own**. That is the
accretion OR-115 describes: each was added when something needed a trigger, and none was ever filed.

| Control | Nature | What it does | Recommendation |
|---|---|---|---|
| **Time audit** (`time-audit-card`) | Diagnostic + calibration input | Transition/set timing over 30–365 d against the current model; also writes `timing-baseline` | **Keep, grouped** under a timing/calibration heading |
| **Program export** (`program-export-card`) | Diagnostic (read-only) | Dumps the active program as text to copy | **Keep, grouped**; collapsed by default |
| **Model assets** (`model-assets-card`) | Diagnostic — *the only way to know* | Q-49 A1 gate: are the eight ONNX models really in object storage? ⚠ *Since Q-49 A4b deleted the repo-tree copies there is no fallback at all*, so storage is the only source and this card is the only place a gap shows | **Keep, never hide deeply.** This is an "once a year, and the only way out of a real failure" control |
| **Backfill per-set HR stats** (`set-hr-backfill-card`) | **Remedy, recurring** | Materialises `set_hr_stats` for sessions whose recap was never opened — attribution only runs from the recap fetch | **Keep reachable.** Not one-off; fix the header that says it is |
| **Backfill per-workout HR summary** (`workout-hr-backfill-card`) | Remedy, mostly historical | Snapshots `workout_hr_stats`; the table sat at 0 rows for every session until the float/integer write bug was fixed | **Keep**, may collapse — the recap keeps it current once seeded |
| **Exercise unit fix** (`exercise-unit-fix`) | **One-off correction** | Rewrites stored weights and estimated 1RMs for unit-confused logs | **Hide** behind a disclosure — the clearest hide candidate on either screen |

### B. `/admin` — the six tabs

| Tab | Nature | Recommendation |
|---|---|---|
| **users** | Operational — activate/deactivate | Keep |
| **invites** | Operational — add/remove invite emails | Keep |
| **exercises** (`exercise-manager`, 764 lines) | Content management — GIFs, AI generation, dataset mirror, reference figure, style anchor | Keep. ⚠ **The largest file on either surface and the densest cluster of controls** — a candidate for its own sub-page, which is a structural question, not a keep/hide/delete one |
| **activities** | Content management — activity types, icons, sort order | Keep |
| **feedback** | Operational — in-app *Report an Issue* intake | Keep. BugFix reads this from the database at session start; the screen is the human view of the same rows |
| **devices** | 3 rows → `oura-ble`, `cadence`, `data-capture` | Keep |

### C. `/admin/oura-ble` — already reorganised, and the pattern to copy

Six numbered `ConsoleSection`s in drain → verify → validate order, each carrying a `when=` line that
says when to reach for it. ~15 consoles across them.

The owner's verdict on this reorganisation was **"Works but could be labeled better"** — so the
*structure* is settled and the *labels* are the open part. Nothing here proposes changing its
grouping. **It is the template for section A**, which currently has no grouping at all.

One ordering constraint is load-bearing and written into the page: step 1's two cards read the server
only, so they answer on a desktop — *"a full disk is most likely exactly when the APK cannot be
opened."* A tidy-up must not fold them into a later section.

---

## What was owed from the owner — answered 2026-10-05

One pass over section A, six rows, with a keep / hide / delete each. **Answered (#2250):** model
assets keep, visible; set-HR backfill keep reachable; exercise unit fix hide behind a disclosure;
program export and workout-HR backfill **keep visible**. Time audit was not asked and stays visible.

**Hide beats delete throughout.** A destructive admin control that is gone cannot be used when it is
needed; one behind a disclosure is out of the way and still there.

## What this inventory does NOT settle

- **Usage frequency.** Not visible in code, not measured, not guessed.
- **Whether `exercise-manager` should be split.** A structural call, not the owner's, and out of
  OR-115's scope.
- **The `/admin/oura-ble` labels.** The owner's "could be labeled better" is a separate, open thread.
- **`/admin/cadence` and `/admin/data-capture`.** Single-purpose pages reached from one row each;
  neither shows accretion, so neither is itemised.

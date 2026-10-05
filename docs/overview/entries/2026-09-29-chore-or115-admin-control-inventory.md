# 2026-09-29 — OR-115: the admin inventory exists, and it moved the entry to the owner

**Branch:** `chore/or115-admin-control-inventory` · docs-only. No product change, no version bump.

OR-115 asked for the admin surface to be reorganised "to only use what we actually need", and its own
rule is **do not start by deleting**: the useful axis is how often the owner reaches for each control,
which is not visible from the code, so the inventory comes first and the keep/hide/delete call is his.
`OR-182` had already removed its `Gate: owner` on the grounds that it was gated on *our* work — the
inventory did not exist. It does now: [`docs/admin-control-inventory.md`](../../admin-control-inventory.md).

## Three findings, each of which changes how the entry reads

**① "The admin section" is two screens, and the one the entry is about is the other one.**
`/admin` is admin-gated with six tabs (users · invites · exercises · activities · feedback · devices).
`/more/settings/developer` holds three diagnostic rows **and six bare maintenance cards** — the
backfills, the unit correction, the export. Those six are the accretion OR-115 describes, and a search
of `/admin` finds none of them. The split is deliberate and documented in `developer-content.tsx`
(`Q-531`/`Q-234`: a drain or re-sync is destructive in the wrong hands and access control outranks the
taxonomy, with an explicit *"Do not re-add a device row to this screen"*). Nothing here undoes it.

**② Nothing is unreachable, so *delete* is never justified on dead-code grounds.** All 19 components
in `components/admin/` resolve from a live import, checked by **export name** across `app/`,
`components/` and `lib/`. That makes this a *too many live controls* problem, which supports the
entry's do-not-delete rule rather than giving a reason to override it.

⚠ **And the first check was wrong in the direction that would have deleted something.** A path-shaped
grep for `admin/<file>` reported `hr-backfill-card.tsx` as **NOT IMPORTED ANYWHERE** — 68 lines that
looked like dead admin code. It is the shared base that both `set-hr-backfill-card` and
`workout-hr-backfill-card` import as `./hr-backfill-card`, and a relative import has no `admin/` in it.
**OR-187 for the third time this session: a grep is a candidate, never a conclusion.** The inventory's
reachability column is by export name and says so, so nobody re-derives it from a path grep.

**③ Two cards say "One-off admin utility" in their own header and are not.**
`set-hr-backfill-card`'s body: re-running it *"is the remedy whenever a workout ends without its recap
being viewed"*, because HR attribution only runs from the recap fetch. That is a standing remedy for a
live gap, not a migration — and it is exactly the sort of control the entry warns about, where rarity
is not disuse. Read the body, not the label; the label is worth fixing.

## What the code can and cannot answer

Usage frequency is not measured and is not guessed. What the code does answer is each control's
**nature**, which is what makes a recommendation arguable: **diagnostic** (reads only), **remedy**
(writes, re-runnable, needed whenever a condition recurs), **one-off correction** (writes once against
historical rows). Only the third is a hide candidate, and `exercise-unit-fix` is the one clear member.

The strongest single row is **model assets**: it answers whether the eight ONNX models are really in
object storage or whether the repo-tree fallback is quietly carrying production — and `getSession`
falls back **silently**. Keep, and never hide deeply; it is the only signal there is.

## What shipped, and where it went

The entry is **re-laned `Lane: O`, ungated**, with an `Ask: owner:` naming the six rows and linking
§A of the inventory. Ungated on purpose — `Gate:` would park it, and per CLAUDE.md getting the answer
is the Orchestrator's work, not owner debt. `next-item.js --lane O` now lists it under *waiting on the
owner*; Lane B's READY dropped to one (`Q-231`).

⚠ **`Ask:` takes only `owner` as its value** — `check-backlog-pointers.js` rejected `Ask: one pass
over…` and the correct form is `Ask: owner: <text>`, as `LA-173` already had it. Caught by running the
checker and **reading its exit code directly rather than through a pipe**, which is this lane's own
standing lesson.

The implementation half comes back to Lane B once he answers: group those six cards under headings,
following `/admin/oura-ble`'s six numbered `ConsoleSection`s with their `when=` lines — the pattern the
owner already called *"works but could be labeled better"*.

## Deliberately not settled

- **Usage frequency** — not visible in code, not measured, not guessed.
- **Whether `exercise-manager` (764 lines, the densest control cluster on either screen) should be
  split.** A structural call and mine to make, but out of OR-115's scope, so not made here.
- **The `/admin/oura-ble` labels** — the owner's "could be labeled better" is a separate open thread.
- **`/admin/cadence` and `/admin/data-capture`** — single-purpose pages reached from one row each,
  neither showing accretion, so neither itemised.
- **Nothing was hidden or deleted.** That is the point: this PR is the list.

One ordering constraint recorded so a later tidy-up cannot break it: `/admin/oura-ble` step 1's two
cards read the server only, deliberately, because *"a full disk is most likely exactly when the APK
cannot be opened."* Do not fold them into a later section for tidiness.

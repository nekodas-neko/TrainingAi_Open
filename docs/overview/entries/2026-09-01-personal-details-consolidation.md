# 2026-09-01 — the personal details are one screen, and one writer

**Branch:** `feat/bf-79-personal-details` · **Entry:** BF-79 · **Lane:** B · **Version:** v1.416.0

## The request

Owner: *"can we combine all the personal information fields into 1 section in the more/details. Like
height/weight/bodyfat etc."*

They were split in two. `EditProfileSheet` owned the display name; the Goals accordion's
`RequiredInfoSection` owned height, birth year and biological sex. Until BF-78 each editor also
**resent the other's fields** from a possibly stale `user` prop, so a save from one could overwrite a
change made in the other. BF-78 deleted the resends; what was left was the mess — two places to look
for one row of the `users` table.

## What shipped

**A new screen at `app/more/details/`, reached from a `Profile` group on the More tab.** It holds
the display name, biological sex, birth year and height as editors, and weight and body fat as
**read-only measurements** with a button to where they are actually logged.

**Weight and body fat are deliberately not editable here.** They are measurements with a history —
logged daily, with the profile only ever showing the latest — so an input on a profile screen would
open a second write path into `body_metrics`, which is the shape the offline-first rules exist to
prevent.

**Targets and activity level stayed in Goals.** A target weight or a step goal is not a personal
detail, and moving them would have relocated the split rather than closed it. What used to be headed
*Required Information* now holds only the two body targets and activity level, and is headed
**Targets & Activity** because that is what it is.

**The Goals section gained the way back.** It still refuses an AI recommendation until height, birth
year and sex are filled — and it can no longer edit them, so naming a field the user cannot reach
from there would have been a dead end the move itself created. Its missing-field list is split, and
an **Open Profile details** button ships with the move.

## Two findings that are not this entry's to fix

**A user who already has a password cannot change it (LB-40).** `EditProfileSheet` initialises
`hasPassword` to `false` and never fetches it, so the *Current password* field is never rendered —
while `app/api/user/password` requires it whenever a hash exists. The flag is already in the
`/api/user/profile` payload the parent reads.

**`weight_goal_kg` and `target_weight_kg` are two columns for one goal (LB-42).** The first is edited
in the Edit Profile sheet and read only by the AI recommendation prompt; the second is edited in
Goals and is what the Health page renders. So the number the user sees as their goal and the number
the model is told can differ. Resolving it picks a winner and migrates the loser — a schema decision,
so **Lane A**, and deliberately not settled from a UI PR.

A third, smaller one: the **Weight Units toggle has no consumer at all** (LB-41) — nothing in the app
mentions `lbs` outside that one file, and the state resets to `kg` every time the sheet opens. Gated
on the owner, because removing a row they may believe in is theirs to hear first.

## A bug the gate caught in my own new code

The date label beside each measurement was copied from `goals-section.tsx`, which built it as
``new Date(`${date}T00:00:00`).toLocaleDateString('en-AU', …)`` — no `timeZone`, so it renders in the
**device's** zone rather than the user's. `check-timezone-rendering.js` failed on the new file
immediately. Both sites now use the shared `formatDateDisplay`, which builds the date component-wise
and cannot shift; the check's grandfather list shrank by one in the same commit, as its shrink-only
contract requires.

## Verification

- **Against a running `pnpm dev`**, signed in as the seeded user: the screen returns 200 and renders
  all six rows; each of the four fields PATCHes and persists; **saving one leaves the other five
  untouched**, including the sheet's narrowed two-field body, which no longer nulls the display
  name; an emptied height clears to `null` rather than being indistinguishable from untouched.
- **Four source guards, six mutations, all killed** — re-adding `displayName` to the sheet's body,
  re-adding `sex` to the Goals body, removing either of the details screen's own writes, dropping the
  More row, and dropping the Goals link.
- **The first version of that guard could not fail on one case, and mutation is what found it.**
  Deleting the details screen's `heightCm` write still passed, because the screen also *seeds*
  `heightCm` into form state and a whole-file match cannot tell a write from a read. It now extracts
  the `JSON.stringify({…})` / `patch({…})` spans and matches only inside them.
- **E2E:** `profile-group-labelling.spec.ts` follows Biological Sex to its new screen rather than
  losing the assertion with the move — the baton's rule about grepping `e2e/` for a moved
  affordance's accessible name, applied deliberately this time. A new
  `profile-details-consolidation.spec.ts` walks More → Profile details, types a name, and reads the
  **database row** back to prove the other columns did not move; mutated by making the write resend
  its siblings, which fails it.

**Not exercised: the device.** The screen is web-verified only — safe-area clearance under
`MoreSubScreen`'s floored padding, the tap targets on the sex row, and the two measurement buttons at
S25 width are all unchecked on hardware.

## The compaction sweep rode along, because the ceiling made it blocking

Adding this entry took `docs/overview/entries/` to **251**, one over its 250 total ceiling, and that
is a `check-doc-index-size` **failure** rather than the note it prints at the 20-file chore
threshold. So the sweep the check has been asking for since 20 happened here rather than waiting for
an Orchestrator pass: the **22 oldest unlinked** entries folded into
`docs/overview/history-2026-08-30.md` (110 KB → 184 KB, still under the ~250 KB rule), leaving
**229 total, 21 foldable**.

**Only unlinked entries were folded**, per the rule the first sweep learned the hard way — a durable
doc citing a folded path is a broken link, and 48 of them once broke at once, several inside another
lane's baton. Every relative link in a folded body loses exactly one level (`](../../x)` → `](../x)`,
`](../x)` → `](x)`), and a link to a sibling entry that this same sweep was folding is re-pointed at
the history file rather than left dangling. `check-doc-links` passes on 933 files.

## Three merges, and each conflict was a different shape

`main` moved three times while this was in CI (#712/#710, #714/#715, #713/#716), and the resolutions
are worth recording because the repo's rules disagree with each other by file:

- **`docs/implementation-backlog.md`** — twice a pure **two-additions** conflict (my LB-40/41/42
  against BF-87), so both sides were kept. The standing "a backlog conflict is two deletions" rule is
  a common case, not the rule; read the headings.
- **`docs/doc-size-baseline-history.md`** — append-only, so both sides kept, main's first.
- **`docs/doc-size/*.size`** — the one genuine disagreement, twice. Two PRs raising the *same*
  document do not have a mergeable answer, and neither side was right: `projectOverview.md`'s
  baseline was **8593** on this branch and **8586** on main (main had *shrunk* it), with the merged
  file needing **8606**. Recomputed from the merged document each time, never picked.
- **`package.json` / `changelog.ts`** — rebuilt from `git show origin/main:…`, never spliced. The
  version moved v1.413.3 → v1.414.2 → v1.415.0 → **v1.416.0** as other PRs claimed each one.

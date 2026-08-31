# 2026-09-01 — the personal details are one screen, and one writer

**Branch:** `feat/bf-79-personal-details` · **Entry:** BF-79 · **Lane:** B

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

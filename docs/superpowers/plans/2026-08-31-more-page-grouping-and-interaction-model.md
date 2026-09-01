# The More page — grouping and one interaction model (BF-82)

**Written:** 2026-08-31 · **Domain:** `app-shell` · **Lane:** B
**Status:** plan only. Nothing here is implemented.
**Sequencing:** the code half is blocked — see §6. The plan is not.

> **This is the second IA plan for this screen, and the first one is still the authority on what
> lives where.** [`2026-08-14-more-tab-information-architecture.md`](2026-08-14-more-tab-information-architecture.md)
> moved sixteen inline sections onto five sub-routes and **shipped**. It also carries an owner
> decision from 2026-08-16 that this plan must not re-open. What BF-82 is reacting to is what that
> migration left behind: the rows are right, the *container* around them is now degenerate.

---

## 1. The inventory, from source

Every `MoreRowGroup` in the app, with the number of `MoreRow`s inside it — counted, not eyeballed:

| File | Group | Rows |
|---|---|---|
| `components/more/profile-tab.tsx` | Program · Health · Devices · Settings · Data · About · Admin | **1 each** |
| `components/more/settings-panel.tsx` | Developer | **1** |
| `app/more/settings/developer/developer-content.tsx` | Device consoles · Diagnostics | 3 · 3 |

**Eight single-row groups, not seven** — the entry missed `Developer` on the Settings sub-screen,
which has the same shape one level down. And the only two groups that group anything are on a
developer screen nobody complained about, which is the tell: the primitive is fine and it is being
used as a decoration everywhere else.

A `MoreRowGroup` is an uppercase 10 px heading plus a bordered container. Around a single row that
is **three stacked elements to present one tappable line** — most of why the screen reads as long
and empty at once.

### What is above the rows

`profile-tab.tsx` renders, in order: the avatar header, `StatsGrid`, `TrophyCase`,
`AchievementsSection`, "Your Year", the season badges, then `GoalsSection` — **all content, all
inline, all deliberate.** That is the 2026-08-16 owner decision; `/more/goals` and
`/more/achievements` "were never built and are not going to be". Do not propose moving any of them.

---

## 2. Three corrections to the entry's premises

**(a) The screen already signals the difference — through a chevron, not through structure.**
`MoreRow` draws `ChevronRight`; `GoalsSection` draws `ChevronDown` and rotates it. So *"the user
cannot predict whether tapping navigates or expands"* overstates it: the affordance exists and is
the conventional one. The real defect is underneath.

**(b) `GoalsSection` does not USE `MoreRowGroup` — it re-implements it.** `goals-section.tsx:~318`
hand-writes the same heading (`px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest
text-muted-foreground`) and the same shell (`rounded-2xl bg-muted/40 border border-border
overflow-hidden`) as the primitive, then puts its own button inside. That is a copied pattern under
the repo's *"any pattern at ≥2 sites gets extracted before a third copy"* rule, and it is why the
two shapes drift: nothing makes them agree. It is also one of the hand-rolled chevron toggles Q-491
tracks — though this one does carry `aria-expanded`, so it is the good example of that class rather
than a bug.

**(c) There are no sliders, and the likely referent is a decision the owner has to make.** The
Settings sub-screen has **five `Switch`es** (calendar sync, day-review reminders, health alerts, rest
chip, run chip) and all five are booleans, where a switch is correct. The controls that fit
*"could be changed from sliders to text or buttons"* are the **goal value fields** in the Goals
accordion, where a target is typed beside the current reading. **This plan proposes no control
change.** A switch is right for on/off and wrong for a value; swapping either way for the wrong
reason is a regression, so the question goes to the owner before any of it is built.

---

## 3. The grouping proposal

**Seven headings become two, and every heading covers three or more rows.**

```
More
  [avatar header · name · level · XP · friend code]
  StatsGrid · TrophyCase · Achievements · Your Year · season badges    ← content, unchanged
  Goals                                                               ← content, see §4

  YOUR SETUP
    Program        Sessions, progression & schedule       → /program
    Health         DEXA & RMR results                     → /more/clinical
    Devices        Ring, strap, scale & permissions       → /more/devices

  APP
    Settings       Notifications, appearance & home layout → /more/settings
    Data & Sync                                            → /more/data
    About          TrainingAI v…                           → /more/about
    Admin Console                                 admin    → /admin

  Send feedback · Edit profile · Sign out
```

**Why two rather than none.** A flat seven-row list needs no headings at all and would be the
simplest change — but `Admin` is conditional and destructive-adjacent, and appended to a flat list it
reads as a mistake rather than as a section. Two groups keep it separable at no cost. **Why not
three or more:** any split finer than *your stuff / the app* puts us back at one-row headings, which
is the defect.

**`Admin` stays inside `APP` rather than keeping its own heading.** It is `isAdmin`-gated, so for
every other user the group is three rows and for the owner it is four — both fine. Giving it a
heading of its own is how it became a single-row group in the first place.

**Do not delete `About` or `Admin` to tidy up.** `About` carries the version string, which is how a
stale-bundle question gets answered; `Admin` is the only route to the console.

---

## 4. One interaction model, and the one exception in writing

**Rule: every row inside a group navigates.** After §3 that is true of all seven with no exceptions,
because the only thing that expanded was never a row inside a group — it was a lookalike above them.

**`Goals` stays inline and stops dressing as navigation.** The owner decided in 2026-08-16 that
Goals is content on the surface, and that stands. What changes is that it should look like the
content it sits among — `StatsGrid`, `TrophyCase`, `AchievementsSection` are all inline cards
directly above it — instead of borrowing the chrome of the rows below it.

- **Recommended:** drop the copied `MoreRowGroup` heading and shell from `goals-section.tsx` and let
  it present as a card like its neighbours, keeping the disclosure button, the `ChevronDown` and
  `aria-expanded` exactly as they are. This removes the duplicated markup (correction **b**) and the
  ambiguity in one edit, and touches no behaviour.
- **Alternative — extract a shared `MoreDisclosureRow`** so the two shapes are visibly siblings of
  one primitive. Better if more inline disclosures are coming; today it would have exactly one
  caller, which is a primitive invented for a single use.
- **Rejected — move Goals to `/more/goals`.** That is the 2026-08-16 decision reversed, and it was
  made deliberately after the size pressure that justified the other splits went away.

---

## 5. Verification

- No `MoreRowGroup` in the app wraps fewer than two `MoreRow`s. **Assert it with a test** rather than
  by reading — the count above was wrong by one when read by eye. A source-level test over the files
  that import `MoreRowGroup` is enough, and it is the only thing that stops the next single-row group.
- `Developer` on the Settings sub-screen is folded in or dropped, or the test excludes it with a
  written reason.
- **Destination parity, enumerated in the PR body:** every route reachable from More before the
  change is reachable after it — `/program`, `/more/clinical`, `/more/devices`, `/more/settings`,
  `/more/data`, `/more/about`, `/admin`, plus the feedback sheet, the edit-profile sheet and sign-out.
- Tap targets stay ≥44 dp; `MoreRow`'s `py-3` plus the global floor already satisfies it, so this is
  a check that nothing regressed rather than new work.
- **On the S25**, which is where "reads as long and empty" was diagnosed and is the only place it can
  be judged.

---

## 6. Sequencing — why the code half is blocked and the plan is not

BF-82 decides **placement**; **BF-79** decides the **content** of the personal-details section that
placement has to hold; and BF-79 is parked behind **BF-78**, which is **Lane A** (a partial PATCH to
`/api/user/profile` that nulls four columns). Building the two independently guarantees they disagree
about where height and biological sex live.

**So: BF-78 (Lane A) → BF-79 (content) → BF-82 (placement), or BF-79 and BF-82 together.** BF-82's
backlog entry should carry `Needs: BF-79` as a field rather than stating the sequencing in prose,
which is what let `next-item.js` offer it as READY at the head of Lane B.

**What is not blocked, and could ship alone if the owner wants the screen fixed sooner:** §3's
grouping and §4's Goals presentation touch neither the profile route nor any personal-detail field.
They are a container change. If BF-79 slips, this is separable — but only in that order; doing §3
after BF-79 costs nothing, doing BF-79 after a half-done §3 costs a re-layout.

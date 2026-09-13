# 2026-09-13 — three owner answers, and two of them were filed as "Defer"

**Branch:** `chore/or-109-owner-answers` · two backlog entries amended, one checklist fixed. No product code.

## Where the answers came from

The S25 verification checklist (134 items) is backed by an artifact store, so answers read straight
back — no export, no copying. Four items were answered in the first sitting; three were decisions.

## E2E becomes advisory (LB-56)

Chosen over both alternatives. Two things are recorded beside it so they do not evaporate:

- **The re-require step is the closing condition, not an aspiration.** LB-56's own text warns that an
  advisory check decays unwatched — which is how it reached ten failures unnoticed. E2E returns to
  the required set once `main` is green.
- **The entry does not close on the toggle.** Dropping it from branch protection is a repository
  setting, the owner's click. What stays queued is fixing the four specs. **LB-54's baseline half
  (`Needs: LB-56`) unblocks the moment this lands.**

## The retention rule (Q-30) — read the notes, not the buttons

Both storage questions were tapped **Defer**. Their notes were not deferrals:

> *"Try use as much phone storage as possible. But if its only 21MB; we can keep it for now."*
> *"As long as its ONLY on the [device] storage — I don't want to use railway as a permanent
> solution; so we don't want to store too much on cloud."*

Together: **the phone holds the data; Railway holds the smallest thing that makes a lost phone
survivable.** That settles three of Q-30's four open questions — the server keeps a packed backstop,
the 14-day device window has to change now the device is the archive, and a wiped device restores
from that backstop.

**The condition is the part worth keeping.** 21 MB was *priced*, not exempted. If the packed tier
stops being about that size the decision is re-opened — an entry recording only "yes, keep a
backstop" would let a later session grow it without noticing it had changed the deal.

**One question the answer does not reach:** `error_events` is 52 MB, the second-largest object in the
database and bigger than the whole packed archive, currently holding BF-110 telemetry rather than
faults. Nobody asked about it, so nobody answered it.

## The checklist had a design bug and it produced a false answer

**ASK-4 asked the owner to *clear a field* and offered Works / Broken / Can't check.** They tapped
**Works** — reasonably, since the supplement does work — while the field sat untouched. Production
confirmed it: `dose = '10mg'`, unchanged since 2026-09-06.

A question that asks you to *do* something cannot be answered with a judgement. Four items are now
kind `action` with **Done / Couldn't / Skip**: ASK-4, BF-106 (press VACUUM FULL), Q-71 (the
historical redecode), LA-68 (restore 22 wear-time days).

**ASK-4 is also less urgent than it was filed.** OR-104 shipped in the meantime: the free-text field
now relabels itself to *"Note"* once an amount exists and says *"The amount above is the dose — it is
not counted."* The `10mg` is inert. Its code comment explains why it was relabelled rather than
hidden: *"a field you cannot see is a field you cannot correct."*

## Not done

- The branch-protection toggle (owner's click).
- The `CLAUDE.md` growth figure — still says ~0.4 MB/day against a measured 1.8. The owner's answer
  was about *where data lives*, not about that number, so it stays open rather than being read into.

**Surfaces not exercised:** none apply — docs and a checklist page; no runtime code, no schema.
`pnpm check:rules` **Ran 74 of 74**.

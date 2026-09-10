# 2026-09-10 — the queue sweep: a starved lane, a gate that overreached, and a batch that was refused

**Branch:** `chore/or-106-queue-sweep` · queue fields and docs only · no product code.

## Why

Lane B's READY list was **empty** — the same complaint that opened this run of Orchestrator work, back
after the reta tracker shipped. A full pass over all 337 entries, asking three questions: what can be
cleaned up, what can be given a lane, and what can ship as one PR.

## Lane B was starved by two entries, and only one of them deserved to be

**PS-35 → PS-35a / PS-35b.** The entry carried `Gate: owner for the page deletions` — a gate that
prose scoped to *one* of its five parts. `next-item.js` reads `Gate:` as a property of the whole
entry, so a decision about deleting five redirect pages was also parking a wrong PWA `start_url`, a
boot warm that re-fetches home's three heaviest requests (**measured ×2 on Fast-3G**), a dead
rehydrate branch, and a weather chip that pulses forever with an unkeyed cache. None of those four
needs an owner. **This is the same defect the `Lane:` field exists for — a label that lives only in
prose.** The gate now sits on PS-35a alone.

**RV-37's gate was answering a different question than the one it blocked.** `/health/day`'s scroll
container is `flex-1 space-y-4 overflow-y-auto scrollbar-hide px-4 pt-4` — no bottom padding at all,
read from source. The entry gated the fix on a device check. But two questions were being answered as
one: *"should a fifth safe-area CI rule exist?"* genuinely needs evidence and stays open; *"should
this one container have bottom padding?"* does not, because a full-height scroller ending flush with
the gesture bar is a defect by CLAUDE.md's own rule, and `/more` already shows the shape to match
(`pb-nav-safe`, 68 px). Fix, then look — the device check moved after the work instead of in front.

**Lane B READY: 0 → 2.** The other ten Lane B parks were checked and left: BF-110 (a Samsung WebView
compositor failure Chrome cannot show), BF-111 (a card that returns early off-native), BF-94, LB-36,
Q-529, PS-10, Q-516, BF-126 are all correctly gated.

## Lanes: 25 tagged, and a shortcut that would have been wrong

Every TN- entry naming a path now carries a `Lane:` derived from §3 — **21 engine, 4 surface**.

**The obvious bulk rule was tried and is wrong.** *"TN- is Tuning, Tuning is scoring, scoring is Lane
A"* would have mis-tagged 4 of 32: TN-19 is `components/body-battery-card.tsx`, TN-28 is
`components/nutrition`, TN-12 and TN-3b likewise surface-only. A blanket tag sends work to the wrong
agent silently, which is precisely what `scripts/lib/lane.js` exists to prevent. Each was derived
from the paths it names.

Those 4 matter more than their count: TN-12, TN-19 and TN-3b were **invisible to Lane B**, and now
print there with their real blocker next to them — a `Needs:` on a Lane A engine half. Which is the
structural finding: **Lane B starves when Lane A is the bottleneck**, because the engine-first rule
puts B's work behind A's.

## Batching: nothing qualifies, and that is the answer

The rule is *aggregate on what has to be **verified**, never on subject*. Five subject clusters were
tested and every one fails for a concrete reason:

| cluster | why not |
|---|---|
| injury-aware (BF-44 + BF-68) | **tried it — the checker refused it.** Different lanes, and BF-68 is shipped residue |
| Body Battery (TN-2/15/19, Q-521) | 3 parked, 1 in the other lane — you cannot batch across a park |
| weight goal (LB-42/96/97) | LB-42 is migration 246; the rule forbids batching a migration |
| activity factor (BF-102 + LB-50) | already sequenced by `Needs:`, which is the A-then-B split, not a batch |
| hourly movement | spans both lanes |

The one I actually attempted, `injury-aware-surfaces`, was **rejected by
`check-backlog-pointers.js`**: *"a batch ships as one PR and a PR is one lane's work."* The tool was
right and the proposal was wrong — BF-68 had already shipped, and my throwaway parser missed it
because that entry writes `**Keep —**` rather than `**Keep:**`. `next-item.js` handles both correctly
via `lib/keep.js`; only my scratch script did not, so there is no repo defect here.

## The lane count in the first draft of this entry was wrong

An earlier version of this write-up, and of OR-106, said **90 entries state no lane** and that
coverage had gone 68% → 82%. Both numbers came from a throwaway regex in a scratch script,
`/\*\*Lane:?\*\*/`, which requires the colon *outside* the bold. Many entries write `- **Lane: A**`
with it inside. `scripts/lib/lane.js` reads both — that is the whole reason the module exists — so
the scratch script disagreed with the shipped parser and the scratch script lost.

**The real figure is 16 of 340, and coverage is 96% (August) / 94% (September) — flat.** Cross-checked
against `next-item.js`'s own `⟨lane unstated⟩` marker, which independently names 16.

**None of the 16 is startable work**: nine `Verify:`, one `Keep:`, one `Reference:`, five parked. So
the 25 tags this PR does add are worth having, but they close a gap that was never 115 wide, and the
follow-up OR-106 asks for is now *small and conditional* rather than a sweep.

**The lesson, written into OR-106:** measure lane coverage with `laneFromLines()`, never a fresh
regex. A parser exists precisely because the field has more than one written form.

## Not done

- **16 entries state no lane**, none of them startable work — see the correction above. Filed as
  **OR-106**, which now says to add a lane when each is next touched rather than sweeping for it.
- **Q-395 is 300 lines of shipped spec sitting in the queue file** — every phase has landed and what
  remains is a completion checkpoint. It belongs in `docs/` with a short entry pointing at it. Not
  done here because moving it is a judgement about where the spec should live, and this PR was
  already large. The backlog is at 20,349 lines against a ceiling that has blocked PRs before.
- The device gates listed above are unchanged and still owed.

**Surfaces not exercised:** none apply — queue fields and docs only; no runtime code, no device path,
no schema.

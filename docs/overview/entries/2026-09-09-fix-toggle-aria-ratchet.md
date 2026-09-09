## 2026-09-09 — A ratchet for toggle ARIA, built on a different signal than the one that failed (Q-491, Lane B)

**The residue was a judgement call, and the honest way to answer it was to measure.** Q-491 left
*"a real ratchet script, **if one is worth building**"* — the entry's own attempt at the obvious
heuristic (a file with a Chevron icon, no `CollapsibleTrigger`, no literal `aria-expanded`) matched
**34 files**, almost all back-button chevrons, and was rightly abandoned as *"a bigger version of the
same problem"*.

**What changed is the signal, not the tuning.** This one does not look at icons at all. It matches a
`set…(v => !v)` **inside an `onClick`** whose state also gates a conditional render — the shape of a
control that shows or switches something. A back-button chevron navigates and never matches; derived
state like `setLoading(!seeded)` is not in a click handler and never matches.

| detector | candidates | real |
|---|---|---|
| Chevron + no `CollapsibleTrigger` + no `aria-expanded` (Q-491's attempt) | 34 | 2 |
| click-toggled state that gates a render | 8 | 4 |
| …with the toggle required inside the `onClick`, and `aria-pressed` excluded | 1 | 1 |

**All five were fixed, so the baseline is empty.** `program-export-card`, `injury-card`,
`trophy-case` and `oura-ble-debug` took `aria-expanded` + `aria-controls` pointing at a `useId` on
the revealed region; `session-select-content`'s reorder button took `aria-pressed`. An empty baseline
is what makes this a regression check rather than a debt list — the same shape LA-19 reached for
`aestMidnight`.

**The finding that made the earlier version dangerous rather than merely noisy.** A static check
cannot tell a **disclosure** from a **mode toggle**, and the correct attribute differs.
`app/coach/coach-content.tsx` swaps the whole panel between history and composer and is already
correctly `aria-pressed`; `session-select-content` put the sections into reorder mode and had
neither. A check that said *"add aria-expanded"* would have pushed the wrong attribute onto both,
and a wrong ARIA state is worse than a missing one. **So the check reports the question** — reveal a
region, or turn a mode on — and its failure text says so instead of prescribing.

**Verified by being made to fail.** A probe component with the bare shape fails it; the same file
with the attribute passes. Reverting `trophy-case`'s fix did *not* fail the branch, which is correct
and worth recording — `verdict()`'s inherited rule spares debt the base branch already carries, so
proving the check bites needs a *new* violation, not a restored old one.

**And an e2e for the half a static check cannot reach.** `toggle-aria-state.spec.ts` asserts the
value **flips**: a toggle hardcoded to `aria-expanded={true}` on both branches passes every grep and
tells a screen reader nothing. Mutation-checked by pinning `aria-pressed={false}` — the spec fails.

**Also recorded:** Q-300's residue was gated on the owner in prose (*"once the owner has seen the
framing"*), so the queue tool offered it as startable UI work. It is now a `Gate: owner` field, with
the framing on it — the coaching line is *"your rest ignores the plan"*, not *"you rushed today"*,
because 40% of every session rushes.

**Not exercised.** TalkBack, which is Q-491's remaining `Keep:`. An attribute being right in the DOM
is not the same as the announcement reading well, and nothing in the sandbox can hear it. No user-
visible change, so no version bump.

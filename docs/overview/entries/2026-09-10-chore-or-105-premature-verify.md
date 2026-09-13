# 2026-09-10 — five entries were filed as shipped and never built (OR-105)

**Branch:** `chore/or-105-premature-verify` · queue fields only. No product code.

## What a premature `Verify:` costs

`next-item.js` reads `Verify:` as **shipped — a look is owed, nothing is blocked**. An entry that
carries one while its work is unwritten is therefore filed where nobody looks: not in READY, where an
implementer would take it, and not in PARKED, where a reason is printed and invites a question. This
is the defect that hid the reta tracker's entire surface for two days (OR-102b).

## The method, after two guesses that did not work

**"Carries a `Verify:` with no `Branch:`"** over-caught — it flags every shipped entry that simply
never recorded a branch, which is most of them.

**"No commit mentions the id"** was wrong too; every one of the eighteen had a mention.

What discriminates: **does any commit mentioning the id also touch a non-docs file?** A filing commit
only touches `docs/`. Nine of eighteen had none.

**That still over-catches, and checking is what settled it.** RV-38 has no code-touching commit, yet
`components/body-battery-card.tsx` carries a real `battery.hasData` branch — it shipped. So each
candidate got one targeted grep for the thing it claims.

## Five proven unbuilt, now READY again

| entry | what proves it |
|---|---|
| **RV-40** | neither named route contains `invalidUuidResponse` |
| **RV-44** | longhand `proteinG * 4 + carbsG * 4 + fatG * 9` still in `scan-totals.ts:41` and `meal-split.ts:189`; `atwater.ts` appears only in comments |
| **RV-41** | `lib/coach/patch.ts` imports nothing from the targets or goals routes and declares no bounds |
| **RV-36** | `app/nutrition/nutrition-content.tsx` has no scroll-restoration reference at all |
| **RV-42** | `replaceMealPlanStructure` checks `ownedPlan` for the plan, then inserts `mealTypeId` and `savedMealId` from input unchecked |

Lane A READY 13 → 16, Lane B 2 → 3. Each carries the proof line, so the next session can check or
refute it in seconds rather than re-deriving the verdict.

**RV-42 is worth reading on its own** — it is a cross-account write path, not a cosmetic gap, and it
has been sitting under "nothing is blocked" since it was filed.

## What was deliberately NOT done

**No `Branch:` was added to the nine entries that had shipped**, though that is the obvious way to
stop the scan re-flagging them. The commit the scan finds is frequently an **incidental mention**:
PS-24's top hit is OR-102a's commit, BF-53's is PS-39's, BF-96's is BF-116's. A wrong `Branch:` is
worse than an absent one, because the next scan trusts it.

## Still unresolved (3)

- **RV-39** — the ring card's real state is BLE, which the web build cannot reach; neither the code
  nor the sandbox can settle it.
- **BF-119** — the store says *"never auto-resume a stale active"* and the screen says *"no
  pause/resume"*, which neither confirms nor refutes a loss of samples across a process kill.
- **LA-57** — carries **⛔ REFUTED** in its heading *and* a `Verify: device`. A refuted finding owing
  a device check is a contradiction; someone has to decide whether it is a live question.

**Surfaces not exercised:** none apply — queue fields only; no runtime code, no device path, no
schema. `pnpm check:rules` **Ran 73 of 73**.

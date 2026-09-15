# 2026-09-16 — BF-167: the deload is applied and the toggle says otherwise (BugFix intake)

Docs-only. Owner: *"I dont know if its triggered deload or not. I accepted the ai reccomensatuon."*

## It did. Every exercise is cut.

| exercise | prescribed | `preDeload` |
|---|---|---|
| Barbell Bench Press | **52%** | 76% |
| Barbell Overhead Press | **52%** | 72.5% |
| Cable Chest Dips | **52%** | 70.5% |
| Dumbbell Fly | **52%** | 76% |
| Tricep Cable Combo | **52%** | 76% |

All five carry `deloaded: true` and `deloadNote: "Deload — illness radar: elevated"`.

## And the same stored object says `deload: false`

`prescription.deload` reads **false** on this row and the three before it, while the exercises inside
read `deloaded: true`. The disagreement is inside one JSON blob, and the toggle reads the flag:

```tsx
prescribedDeload={… && !!periodization?.state.prescription?.deload}   // false here
```

So `DeloadToggle` renders *Full — **As prescribed*** over a session at 52%.

## The component is already right — do not touch it

BF-8 fixed the labels and its comment names this exact failure: *"When the engine has already applied
a deload, Full is an OVERRIDE of it — and saying 'as prescribed' there is how the screen came to
contradict the card below it."* It behaves correctly **when told the truth**.

The root is that the two fields answer different questions. `prescription.deload` means *this is a
deload prescription* — a phase decision. `exercises[].deloaded` means *this exercise's load was cut*,
here by the illness radar **after** the model produced its plan. BF-8 wired the label to the phase
flag, and a per-exercise safety deload never sets it.

Recommended: read `exercises.some(e => e.deloaded)`, which is the question the label actually asks. A
phase deload sets `deloaded` on its exercises too, so one read covers both.

## The same cause, one paragraph lower

The rationale says *"within the **72.5-80%** intensity band for the primary compound"* against rows at
**52%** — those are the `preDeload` figures (bench 76%, inside the band). The prose was written before
the radar cut the loads and nothing regenerated it. BF-99's class again, and fixing the toggle does
not fix it.

## Cleared, so it is not refiled as a bug

The rationale's *"50-min working budget"* against a picker showing **Normal 60 min** is **correct**.
`effectiveTimeBudgetMin` is `workingBudgetMin(total)` — total minus the warm-up carve-out — so ~48–50
of a 60-minute session is right, and the model says *"working budget"* precisely. All 23
`program_sessions` rows carry `time_budget_minutes = 60`. Two right numbers measuring different
things; I nearly filed it as a hallucination.

## Not exercised

Docs only. Every figure is a production read of `session_periodization` and `program_sessions`.

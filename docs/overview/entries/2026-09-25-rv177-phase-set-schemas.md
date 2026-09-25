# RV-177 — the three phase-set writes had no schema at all

**Branch:** `fix/rv177-phase-set-schemas` · **Lane A** · `[platform][workouts]`

Three more of RV-177's nine gaps. Three remain, none re-verified.

The claim held exactly: `POST /api/phase-sets`, `PUT /api/phase-sets/[id]` and
`POST /api/phase-sets/clone` each did `const body = (read.body ?? {}) as { … }` — a cast, not a
check. `durationCycles` reached the driver unvalidated, `phaseType` could be any string, and a
malformed body answered with a bodiless 500.

`PhaseSetWriteBody` and `PhaseSetCloneBody` now live in
`packages/shared/src/validation/phase-set.ts`, beside the other write validators.

## The bounds came from production, not from the obvious precedent

`generated-program.ts` already bounds `durationCycles` at `z.number().int().min(1).max(52)`, and
copying that was the first move — the repo's own rule is to reuse the existing formula.

It would have been wrong. The phase editor's stepper floors at `Math.max(0, …)`, and
`program_phases` holds **8 rows at `duration_cycles = 0`** today. A `min(1)` here would have
answered 400 when the owner re-saved a phase set that is already in his database — a validator
"hardening" a route by breaking it.

So the bound is `min(0)`, and **whether 0 should be reachable at all is left open**: the AI path
forbids it, the editor allows it, 8 rows have it. That is a product question, and this change is
about stopping unchecked input reaching the driver, not about changing what the app accepts.

`phaseType` was checked the same way before choosing an enum over the looser
`z.string().max(60)` the AI path uses — all five values in production are inside the six-value
union, so the enum refuses nothing real. 52 and 100 are taken from `generated-program.ts` rather
than invented, and every bound is a named constant (Q-164).

## `.strict()`, and why the first draft was not

The first draft left `PhaseInput` non-strict so Zod would silently drop the three editor-only keys
the client sends — `localId`, `position` and `primaryStyleName`. `check-strict-request-schemas`
refused it, and the check was right: a silent drop hides a client/server mismatch, so a renamed or
typo'd field vanishes without a word.

The keys are now **declared** instead. The app's payload stays valid, an unknown key is a 400, and
a case pins both halves.

## Verification

20 cases in `packages/shared/src/validation/__tests__/phase-set.test.ts`. Most of them pin what the
schema must **not** reject: a validator added after the fact is far likelier to break a payload the
app already sends than to miss an attack.

| mutation | killed |
|---|---|
| `min(0)` → `min(1)`, the bound production forbids | 1 of 20 |
| drop the integer constraint on `durationCycles` | 1 of 20 |
| `phaseType` enum → free string | 1 of 20 |
| remove the clone override's ceiling | 1 of 20 |
| **control:** raise the phase-name ceiling 100 → 120 | **0 — survived, as intended** |

**The override mutation first read as surviving and did not.** The shell quoting meant the replace
never matched, so nothing was mutated — a green run proving nothing. Re-run with an asserted match
count it kills its case. A mutation that does not assert it applied is not a mutation.

Gates: `tsc --noEmit` clean · **`typecheck:tests` at baseline (88 files)** · lint 0 errors ·
**Ran 79 of 79 Custom Rules steps** · `app/api/__tests__` 32 files / 265 tests · full suite green.

## Not exercised

Server-side validation only — no schema change, no migration, no local-store change, no device path.
The routes were not driven by hand on `pnpm dev`; the schemas are pure and tested directly, and the
32-file route suite covers the handlers around them. No user-visible behaviour on any payload the
app actually sends, so no version or changelog bump.

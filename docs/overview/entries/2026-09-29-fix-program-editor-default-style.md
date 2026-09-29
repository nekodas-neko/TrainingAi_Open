# 2026-09-29 — LB-186: the program editor no longer adds a styleless exercise

**Lane B.** Branch `fix/program-editor-default-style`. UI only — no migration, no API change, no APK.

## The entry's diagnosis held; its prescription could not be followed literally

`LB-186` traced the gap link by link and every link was still true on `main`: `addExercise` created
`{ key, name: "" }`, the type marks `styleId` optional, the route checks only a *provided* id, and the
save writes `styleId ?? null`. **No layer objected**, so a slot was styleless whenever the picker was
never opened — which cost `BF-200` a full working weight in a deload week.

Where it could not be followed as written is the word **role**. The entry says to give the new slot
*"the style its role already uses"* — but **a newly-added slot has no role yet.** The editor shows the
role pills only in the non-Linear approaches, and the style picker only in Linear, so the two are
never on screen together; a slot added in Linear stays unclassified for its whole life.

So the fix reads the program in two places rather than one:

- **at add time**, with no role to go on, the new slot takes the style this *program* uses most;
- **when a role is set** on a slot that has **no** style, it takes the style that *role* uses most.

The second half is what makes "by role" real, and it is guarded on `!e.styleId`, so a style the user
picked is never overwritten. The guard cannot tell a slot that was never styled from one deliberately
set back to *No style*, and it does not try: the only way to reach the role pills with either is to
switch approach while **creating** a program (approach is fixed once a program exists), and in the
role-driven approaches a style is what the deload override needs, so re-filling there is the better
of the two wrong answers.

## Read off the program, never a named default

The entry names `Hypertrophy 3-set`, `General` and `Powerbuilding` — those are *his* styles, on *his*
data. Styles are user-defined rows and session names are user data, so the only authority for what a
program uses is the program. `defaultStyleIdForSlot` counts the styles its own slots carry, prefers
the role's, falls back to the program's, and only then to the first style the user has. It also drops
any id that no longer resolves: the editor already flags an unresolvable `styleId` with *"Style … not
found — please reassign"*, and handing a new slot that same dead id would spread the amber row rather
than fill a gap.

A program with nothing styled yet still gets a style rather than a null, because **the null is the
bug**. It shows in the picker, where it can be changed — and the picker still offers *No style
(default sets)*, which the e2e spec asserts, so nothing here takes the choice away.

## `LA-177` is now unblocked

It carried `Needs: LB-186` precisely so the backfill would not run while the editor kept minting the
tenth styleless slot. Removing this entry from the queue clears that.

## Verified

- `npx vitest run components/config/__tests__/default-exercise-style.test.ts` — **9 passed**, covering
  role-preferred, program-wide fallback, no-role-at-all, a deleted style, an unstyled program, no
  styles at all, and tie stability.
- `e2e/lb186-new-exercise-has-a-style.spec.ts` — builds its own program in the editor, adds an
  exercise, and reads the row's picker: non-empty, and still settable back to no style.
- The spec **builds** a program rather than editing the seeded one, and that was forced rather than
  chosen: the picker renders only in the Linear approach, the Training Approach control exists only
  while *creating*, and the seeded program's `phase_mode` reads `ai_dynamic` in this sandbox's
  database today — a value an earlier spec in the same run changed. Reading the assertion off the
  seed would have made it depend on spec order, which four shards now vary per database.
- **The entry's own proof, observed rather than argued.** A one-off scratch spec (run locally, not
  committed — it saves a program, which would mutate state every later spec in that shard's database
  reads) built a program in the editor, added `Bench Press` without touching the picker, and pressed
  Save. The row read back from Postgres:
  `LB186 SCRATCH / SCRATCH SESSION / Bench Press / 56d6cdf2… / Standard` — **`style_id` non-null**,
  which is what `LB-186` asked for. The scratch program was then deleted from the local dev database.
- Full gate on the final tree: `npx tsc --noEmit`, `pnpm check:rules` (**Ran 83 of 83**), `pnpm lint`,
  `pnpm test`, `pnpm build`.

## Not exercised

- **The device**, and deliberately **no Known-Issues row for it.** The gate in Canonical Runtime
  names offline-first domains, native plugins, safe-area, gestures and notifications; this is none
  of them — a default in client form state, in a surface that is not local-first, exercised in a
  real browser and read back out of Postgres. The one device-shaped thing here is that the picker
  is a native `<select>` whose sheet is Samsung's, and that markup is unchanged.
- **Existing styleless slots.** Nine of them sit in the active program and they are `LA-177`'s, a
  production backfill on Lane A's side of the split. This PR stops the tenth; it does not fix the nine.

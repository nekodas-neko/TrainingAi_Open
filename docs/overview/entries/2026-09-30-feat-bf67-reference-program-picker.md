# 2026-09-30 — BF-67 step 3: the parameter had no caller for a month

**Branch:** `feat/bf67-reference-program-picker` · v1.486.9. The Lane B picker; the engine half
shipped 2026-08-31.

`/api/generate-program` has accepted `referenceProgramId` since 2026-08-31 — resolved server-side
against `listPrograms(userId)`, with session names, exercise names, roles and styles going into the
prompt. **Nothing sent it.** The entry's own `Keep:` said so: *"Nothing reaches the owner until this
ships — the parameter has no caller."*

Fourth item off the KEEP list this session.

## One control, on an existing step

`ReferenceProgramPicker` sits on **step 1**, under the name field, rather than as an eleventh step.
It is optional: no selection sends nothing and the generator behaves exactly as before, which is
what makes an existing step safe and avoids renumbering a ten-step wizard. It self-hides when there
is nothing to reference — a first program has nothing to base itself on, and an empty picker
explaining itself is furniture.

## No Lane A file was touched, and that was a choice rather than luck

Five of this session's head items turned out to be Lane A's engine half, so the first thing checked
was whether this one was too. It is not, on both counts:

- **The program list is already client-reachable.** `GET /api/workout-templates` returns
  `{ programs }` straight off `listPrograms`, and `config-screen.tsx` already fetches it. The picker
  reads it through the **same key, URL, TTL and fetch variant** — one canonical TTL per key, one
  variant per key. `useCachedValue` rather than a `useEffect(…, [])`, because that shape never
  re-runs and a program created in the config screen *behind this sheet* would otherwise never join
  the list (Q-402).
- **The id lives in the wizard's own state, not in `BuilderInputs`.**
  `packages/shared/src/types/builder.ts` is Lane A's file, the route already declares
  `referenceProgramId` at the top level of its schema, and nothing but the POST reads it. It earns a
  place in the shared type when a second consumer wants it — the review screen naming what the
  program was based on being the obvious one.

**`null` is omitted rather than sent.** The schema is `.strict()` and
`z.string().uuid().optional()` rejects an explicit null, so "no reference" has to mean "no key" — a
rejected body would be a 400 for the whole generation, not a quietly ignored field.

## The route's own rule, asserted on the wire

*An id, never a program object* — accepting the structure from the client would be an ownership hole
and a prompt-injection surface for nothing the id does not already give. The e2e reads the **request
body** and checks the id is a uuid and that no `sessions`/`exercises` structure rode along with it.
That is stronger than a source assertion, which could only say the call site looks right.

## Verified

- `components/workout-builder/__tests__/bf67-reference-program-picker.test.ts` — **7 tests**: the
  POST carries the field, `null` is omitted (with the schema's `.strict()` and `.optional()` quoted
  from the route itself), an id crosses and not an object, the key/URL/TTL match `config-screen`'s,
  it is not a fetch-once effect, the picker self-hides and defaults to none, and the empty fallback
  is module-level so it cannot defeat the `memo`.
- `e2e/bf67-reference-program-picker.spec.ts` — **2 passing** at 412 px dark: the picker lists the
  account's real programs on step 1 with `From scratch` pressed by default and the selection moving
  to a chosen one, and the chosen id reaching the request after six more steps.
- **Control-run.** Removing the reference from the POST body reddens the ⭐ e2e test and **2 of the
  7** source assertions. The e2e failure prints the actual body, which is exactly what *"the
  parameter has no caller"* looked like: every field but this one.
- `npx tsc --noEmit` · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 86 of 86** ·
  `check-memo-prop-stability` clean (**97** memoised components now) · `check-component-size` clean ·
  `check-e2e-route-tolerance` and `check-e2e-stub-dates` clean · `pnpm test` · `pnpm build`.

## ⚠ Two things the run taught that reading could not

**The section header reads "Programs", and the state variable is `workoutsOpen`.** My first locator
was `/Workouts/i` — which matched the **tab bar's** own nav item, in another tab's mounted tree, and
`tapInView` refused it with *"every candidate sits in an off-screen tab panel"*. The helper was
right and the locator was wrong: target rendered text, never a variable name.

**`tapInView` scrolls, and step 3 is a `WeightDial`.** Bringing the Next button into view over a
scroll-wheel *moves it*, so the spec's request carries `sessionsPerWeek: 1` rather than the default
3. Harmless here — this spec asserts the reference and the dial floors at 1, so `canAdvance` cannot
be starved — but it is recorded in the spec and on the entry because it is fatal to any spec that
asserts a dial's value after a later scroll.

**And one assertion was testing the wrong thing.** The first version waited for the review screen to
show the stub program's name. The wizard reached step 7 and generated correctly, so that was
asserting `builder-review.tsx` against a deliberately minimal program — a second thing that could
fail, unrelated to this entry. `page.waitForRequest` replaced it: the request *is* the claim.

## Not exercised

- **A real generation.** `/api/generate-program` calls Gemini, so the route is stubbed: what is
  proven is the request the wizard sends, not what the model does with the reference. The engine
  half measured that end-to-end against real Gemini on 2026-08-31 — with a reference, **Barbell
  Overhead Press** and **Barbell Front Squat** appeared where neither did without it.
- **The name-drift caveat**, which is the entry's and is unchanged: the seeded program's
  `Bench Press` does not resolve against the library's `Barbell Bench Press`, because LA-43's
  resolver refuses subset matches. Those names enter the prompt as stored free text.
- **Step 4, the history summary.** Deliberately separate on the entry; step 2 sends structure only.
- **The device.** A wrapped two-column grid of pills on a wizard step, rendered at 412 px. Nothing
  else moved, so nothing is filed as owed.

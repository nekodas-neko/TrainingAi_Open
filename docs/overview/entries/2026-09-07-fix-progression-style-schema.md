## 2026-09-07 — One of the two unvalidated write routes now has a schema (LA-74)

**Branch:** `fix/program-write-schemas` · **Lane A**

### What shipped

`POST /api/progression-styles` had no request schema — it spread the body into
`saveProgressionStyle`. Not mass assignment (the repository names every column it writes), but
nothing typed or bounded a value: `pct` could arrive as a string, `setNumber` as anything, and the
name was capped only by the route's 256 KB body limit. Its two existing guards — name present,
`sets` an array under 40 — read as validation while covering two fields.

`packages/shared/src/validation/progression-style.ts` is now that schema, `.strict()`, and it also
gives LA-73's `promptSafeLine` somewhere to sit on the style name.

### The part worth writing down: I built the wrong thing first

The first version covered **both** routes with `.passthrough()` schemas, reasoning that unknown keys
must survive so no existing caller breaks. `pnpm check:rules` refused it —
`scripts/check-strict-request-schemas.js`, from Q-464, is a ratchet on exactly that: a non-strict
request schema **drops** an unknown key, so a renamed or mistyped field becomes a successful write of
the wrong thing rather than a 400 at the boundary. It was measured live on `POST /api/body-metadata`,
where `{"date":…}` returned `200 {"success":true}` and wrote the weight on today, because the
contract's key is `localDate`.

The check names two exemption classes and **neither applies here**: nothing in `pushMutations` writes
programs or styles, and the poster is the WebView, which ships with the Railway deploy rather than
with the APK. So passthrough was not a scoping choice — it was the defect the rule exists to catch,
proposed as the fix for a different one.

Strict is affordable when a shape has one producer. The style shape does: `config-screen.tsx` builds
`{ id?, name, sets: [{ setNumber, pct, reps, restSec, useFor1rm }] }` and nothing else posts to that
route. So the style half shipped strict, and the program half did not.

### Verification

- `packages/shared` + `lib/__tests__` + `app/api/__tests__`: **3443 passed**, 10 skipped.
- The tests drive the real `POST` handlers. The first block is a **regression guard** on the four
  payload shapes `config-screen.tsx` actually posts — activate, create, edit, recalibrate — because
  the hazard in adding a schema to a write path is the opposite of the one it fixes.
- **Mutation-checked:** removing the parse fails four cases, including *"refuses a set key the column
  list does not have"*, which is the `.strict()` half specifically.
- `pnpm check:rules` — **Ran 68 of 68**, including the strict-schema ratchet that rejected the first
  attempt. `tsc --noEmit` clean, ESLint clean. `pnpm dev`: both routes return 401, not 500.

**Not exercised:** no device. Program and style saving is a WebView path, so a Railway deploy
delivers it, but nothing here was driven through the real editor UI.

### What is still owed — and the enumeration is done

**LA-74 keeps the program half.** `POST /api/workout-templates` still spreads `body.program`. The
reason it did not ship is now in the entry rather than in this session's head: **two producers
disagree.** The editor builds sessions **without** `programId` and exercises **without** `sessionId`;
the activate button posts the whole stored row back with both, plus `userId`, `startedAt` and JSON
date strings against a `Date` type. Every field either producer omits has to be `.optional()`, and
`schedule` is a two-variant union. One wrong key 400s the app's core write path on a device this
sandbox cannot drive — so the four client shapes are pinned as tests, and the schema is left for a
session that can verify it.

Keep the program name unbounded when that happens: `programs.name` is `text`, so a `.max()` would
400 the activation of a program that was fine yesterday.

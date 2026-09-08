# 2026-09-08 — the supplement/vial ownership chain gets tests (PS-39)

**Branch:** `test/supplements-routes` · **Lane:** A · tests + docs only, no product code.

## What shipped

`lib/__tests__/supplements-routes.test.ts` — 24 cases across `supplements`,
`supplements/[id]/vials` and `supplements/[id]/vials/[vialId]`. Batched because they are one nested
chain: a vial exists only under a supplement, and the child routes take **both** ids from the
client. That is the shape CLAUDE.md's write-path rules are written about, and each has a fix in this
chain's own history:

- **(b) Never spread a request body into an update.** `userId` and `deletedAt` are settable column
  keys and the TypeScript `Omit` is compile-time only, so the vial PATCH whitelists field by field
  and `.strict()` refuses the rest — pinned against `userId`, `deletedAt`, `supplementId` and `id`.
- **(c) A client-supplied child id must be ownership-verified through its parent.**
  `createSupplementVial` checks the parent and throws; `withRouteErrors` turns that into a 404
  rather than an unhandled 500 (RV-46).
- **A delete that matched no row is a 404, not a success** (RV-45) — otherwise a client deleting an
  id that is not theirs gets `{ok: true}` and believes it worked.

Two more, numeric rather than structural: `POST /api/supplements` stored a 300,002-character name in
full while its own PATCH sibling capped the same field at 200 (Q-484), and a vial's measurements are
`positive()` rather than merely `finite()` — `strengthMg / 0` is Infinity, which survives every later
multiplication and renders as a plausible dose.

Also pinned: the parent id comes from the **path** and a body-supplied `supplementId` is refused at
the schema; both separators are accepted on every date and normalised to dashes before storage (the
client's `localDateString()` emits `YYYY/MM/DD`, and a slash form reaching a `date` column is read
under the session's DateStyle); `syringeUnitsPerMl` defaults to 100; the create trims and turns an
empty optional string into null; and the listing is keyed to the caller's timezone.

`scripts/check-route-test-coverage.js` baseline 111 → **108**.

## Notes

- **Twelve mutations caught**: removing the create schema, dropping the trim, flipping the defaults,
  ignoring the timezone, `finite()` without `positive()`, taking the parent id from the body,
  dropping `withRouteErrors` on both the POST and the PATCH, `.passthrough()` on the patch schema,
  dropping the date normalisation, reporting success on a delete that matched nothing, and dropping
  the uuid guard.
- **One mutation survived and it is structural, not a gap.** Making the PATCH read `userId` from the
  body cannot fire while `.strict()` stands — the body never reaches the assignment. `.strict()` is
  the guard and it is covered; applying both mutations together fails the strict case. Recorded
  rather than left unexplained.
- The first attempt at the parent-id mutation also survived, for a real reason worth keeping: the
  fixture sent no `supplementId`, so the fallback produced the right answer anyway. The case now
  sends one and asserts the refusal, which is where the guard actually lives.

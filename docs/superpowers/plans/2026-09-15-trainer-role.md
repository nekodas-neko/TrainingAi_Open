# BF-9 — a trainer role: build a program for someone else and assign it to them

**Status:** planned 2026-09-15 (Lane A). Splits into **PR 1 — migration (alone)**, **PR 2 — engine
(Lane A)**, **PR 3 — trainer UI (Lane B)**.

**Owner request, 2026-08-23, verbatim:** *"I want to be able to train people; which means assigning
myself as a 'trainer' and being able to create workout and/or meal plans (meals can be deferred till
later) and assign to other members/users. I.e my girlfriend is using the app; and I went onto her
device and created a program - but Ideally I'd like a UI to be able to do that from my app as an
admin/trainer."*

**Design already approved, 2026-08-23:** *"Go with your reccomendation. There is about 3 users; and
possibly 5 max in the future - all friends no outsiders - so risk woudl be accepted."* This plan does
not re-open the shape — a trainer **relationship** in its own table, and the friendship consent
handshake copied as-is. It settles the parts that were never specified.

---

## 1. One stale claim, removed

The backlog entry says **PR #124 "has been green and awaiting the owner's word since 2026-08-18"**
and that landing it first is the cheaper order. **#124 merged on 2026-08-23** — checked against
`main` rather than taken from the entry, and all three of its artifacts are present:
`scripts/check-admin-claim-in-api.js` exists, it is wired into the Custom Rules job, and
`lib/__tests__/admin-claim-not-authoritative.test.ts` pins the two helpers apart. The only
`isAdminUser(` mention left under `app/api/**` is the comment recording the fix.

**So BF-9 has no prerequisite left.** The ordering argument is discharged, not deferred.

## 2. The trap this feature walks into, and the reason it gets its own section

**`saveProgram(db, userId, program)` is already parameterised by user id** — a trainer route is
literally "call the same function with a different id", which is what makes the feature cheap and
what makes it dangerous. The entry says this. What it does not say is that **the cheap version
reproduces an open bug in this repository**.

`app/api/workout-templates/route.ts:74` validates the program's progression styles with
`progressionStyleIdsOwned(userId, incomingStyleIds)`, which is scoped
`eq(progressionStyles.userId, userId)`. Point that at a trainee and a trainer cannot use a single
style from their own library. Point it at the trainer — the obvious "fix" — and you have built
**RV-42**: a row in one account pointing at a row in another, where `session_exercises.style_id` is
`ON DELETE SET NULL` and the foreign key is the only ownership link, so it proves the row exists and
nothing about who owns it. RV-42 is the reason a PR is sitting owner-gated right now. Building its
twin in a second domain while the first is still unmerged would be a poor trade.

**Recommendation: copy the style into the trainee's account at assign time, and reference the copy.**

- *Why it wins a year out:* the trainee ends up owning every row their program depends on, so the
  program survives the trainer deleting a style, revoking the relationship, or leaving entirely. No
  cross-account edge exists, so no cross-account guard has to be maintained or audited later. It is
  also what the user would expect — a coach hands you a program, not a live link into their account.
- *What it costs:* duplicate style rows, and a later edit by the trainer does not propagate. For a
  training program that is correct rather than regrettable: a prescription you were given should not
  change under you silently.
- **Alternative A — trainee's styles only.** Genuinely better at one thing: zero new code, and no
  duplicate rows at all. It loses because it makes the feature nearly useless on day one — a new
  trainee has no styles, so the trainer can only build programs out of nothing.
- **Alternative B — allow the cross-account reference.** Better at exactly one thing: the trainer
  edits a style once and every trainee's program follows. It loses because it is RV-42, and because
  `ON DELETE SET NULL` turns the trainer's ordinary cleanup into silent corruption of someone else's
  program.
- *Reversal cost:* low. Copy-on-assign is additive — if propagation is ever wanted, it is a later
  feature on top, not an undo.

## 3. What exists and must not be rebuilt

| piece | where | what it gives |
|---|---|---|
| Consent handshake | `friendships` (`requesterId`/`addresseeId`/`status`), `lib/data/postgres/slices/social.ts` | `pending → accepted`, and the accept is scoped `addresseeId = userId`, so **only the addressee can accept** (`social.ts:65`) |
| Discovery | `users.friend_code` (UNIQUE) | naming a user without knowing their email |
| Onboarding | `invited_emails` | how a new trainee gets an account |
| Authorization pattern | `requireAdmin` (`lib/admin.ts`) | reads the row **every call**, ignores the JWT claim — the pattern `requireTrainerOf` copies |
| Delivery | `getSyncDelta(userId, …)` | `programs` is already a sync domain, so a program written under the trainee's id reaches their device on their next pull with **no new sync work** |

**The delivery corollary, stated so it is not filed as a bug:** the assigned program will **not**
appear on the trainer's own device, because it is not their data. The trainer UI reads it over the
network. That is correct.

## 4. PR 1 — the migration, alone

A migration ships alone; this one carries nothing else.

```sql
CREATE TABLE trainer_relationships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trainee_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL,          -- 'pending' | 'accepted' | 'revoked'
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trainer_id, trainee_id)
);
```

Deliberately the same shape as `friendships`, including the pair uniqueness, because the handshake is
the same handshake. **Directional, unlike a friendship** — `(A trains B)` and `(B trains A)` are two
different rows and both may exist.

- Take the **next free migration number at implementation time**, not one reserved now — this plan
  may sit in the queue while other Lane A migrations land.
- Add the `claude_ro` view in the same migration, as the sibling tables do.
- **Reversible** in the destructive sense — it creates a table and drops nothing — **but it is still
  gated (§7).** Reversibility is not the only trigger for the carve-out here; see §7.

## 5. PR 2 — the engine

**`lib/data/postgres/slices/trainer.ts`**, modelled on `social.ts`:
`requestTrainee`, `acceptTrainer` (scoped `traineeId = userId`, mirroring `social.ts:65`),
`revokeTrainer` (either party), `listTrainees`, `listTrainers`.

**`requireTrainerOf(trainerId, traineeId)`** — reads `trainer_relationships` **on every call** and
requires `status = 'accepted'`. It never consults the JWT. This is `requireAdmin`'s rule, and
`scripts/check-admin-claim-in-api.js` exists because a route once ignored it.

**`POST /api/trainer/programs`** — the one write. In order:

1. `requireTrainerOf(session.user.id, body.traineeId)` — 403 otherwise.
2. **Zod-whitelist the body.** Never spread a request body into Drizzle `.set()`/`.values()`:
   `userId`, `deletedAt` and `createdAt` are settable column keys and the TypeScript `Omit<>` is
   compile-time only. Note the existing route at `workout-templates/route.ts:84` spreads
   `...body.program` and then re-stamps `userId` — the trainer route must not copy that shape, since
   here the id is attacker-adjacent rather than always the session's own.
3. **Copy the referenced progression styles into the trainee's account** (§2), then validate with
   `progressionStyleIdsOwned(traineeId, …)` against the copies. The validation runs against the
   trainee because the trainee is who the rows will belong to.
4. `saveProgram(db, traineeId, program)`.
5. **Check the affected-row count before any dependent child write** — a 0-row match followed by an
   unscoped child delete/re-insert is the cross-user wipe class CLAUDE.md records across three
   domains.

**Cache invalidation:** a program written under the trainee's id must invalidate *their* program
structure, through the named group in `lib/cache-groups.ts` — never a hand-rolled key list. Their
device picks it up on the next pull; there is no cache of theirs on the trainer's device to clear.

### Tests

- A trainer with `status = 'pending'` gets 403; `accepted` gets 201; `revoked` gets 403.
- **A non-trainer writing at an arbitrary trainee id gets 403** — driven as a real second account
  against a seeded user's rows, the way RV-42's write-up drove both its doors. A unit test that
  mocks the guard proves nothing here.
- The saved program's `user_id` is the **trainee's**, and a body attempting to set `userId` to the
  trainer's does not change that.
- A program assigned with one of the trainer's styles ends up referencing a **copy owned by the
  trainee**, and deleting the trainer's original leaves the trainee's program intact. This is the
  regression test for §2 and the reason it is worth writing first.
- `acceptTrainer` called by the *trainer* does not accept their own request.

## 6. PR 3 — the trainer UI (Lane B)

Trainee list, a request-by-friend-code flow, and the existing program builder pointed at a selected
trainee. Nothing here decides authorization; it consumes §5's routes.

## 7. Scope and gates

- **Workout programs only. Meal plans are deferred** — the owner's own split (*"meals can be deferred
  till later"*), recorded here as a decision rather than an omission.
- **The risk acceptance does not relax two things**, and neither is a threat-model question:
  the **write-path ownership guards stay** (they stop a *bug* writing into a real person's training
  history, which the sync engine then propagates to their device — trust between users does not make
  a wrong `user_id` less wrong); and **`isAdmin` is still not the trainer flag** (admin opens
  `POST /api/admin/db-query`, read-only SQL over the owner's whole health history, plus the error
  console and writes into the shared exercise catalogue — "all friends, no outsiders" is an argument
  about trainees, not an argument for handing a training partner raw SQL against production).
- **No fine-grained read scopes.** ~3 users, 5 at most, all known to the owner: no permission matrix,
  no audit trail, no tenancy model, no invite-at-scale flow.
- **⚠ Ask the owner before merging ANY of it, PR 1 included.** BF-9's entry is explicit — *"Ask the
  owner before merging **any of it** … unlike most entries the carve-out is the whole feature rather
  than one migration inside it"* — and that second clause means the gate is WIDER than usual, not
  that the migration falls outside it.
  **⚠ Corrected 2026-09-15, hours after this plan was first written, because the first version got
  this backwards and did it in the most misleading way available: it quoted the entry's own sentence
  while inverting what the sentence says.** It read the "rather than one migration inside it" clause
  as carving the migration out, and argued from `CREATE TABLE` being additive and reversible. That
  argument is sound about *destructiveness* and beside the point about *authorization* — which is a
  separate trigger in CLAUDE.md's carve-out, and the one the owner's instruction is aimed at. The
  harm from acting on the wrong version would have been small (an empty table on production) and the
  harm from the pattern is not: a plan that quietly loosens a gate the owner set, using the gate's
  own words, is how a stated decision stops binding. Nothing about the table's shape changed — only
  whether it may merge unasked. It may not.

## 8. The acceptance test

Building a program for someone today means physically holding their phone. **Done is the same
program, built from the trainer's own app, appearing on the trainee's device without anyone handing
over a device** — and the trainee having accepted the relationship first.

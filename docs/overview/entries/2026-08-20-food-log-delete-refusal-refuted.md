# 2026-08-20 — LA-14 refuted: the food-log DELETE's 200 is correct (LA-14)

**Branch:** `fix/food-log-delete-refusal` · **Lane A** · **removes LA-14 without implementing it**

## What the entry proposed

`DELETE /api/nutrition/food-logs/[id]` answers `{"success":true}` for a log that is not yours, because
`deleteFoodLog`'s soft-delete UPDATE is scoped to `user_id`, matches nothing, and returns normally.
Its sibling `PATCH` throws `NotFoundError` in the same situation and answers **404** (RV-33). I filed
the inconsistency this morning and said to check the outbox before choosing a posture.

**The check refutes the fix.** Three findings, in the order they mattered:

## 1. The route is the recovery path for a failed local delete

`app/nutrition/nutrition-content.tsx` deletes locally and queues an outbox mutation; the HTTP DELETE
is its fallback, and the comment there says so outright — *"also the on-device recovery path when the
local delete above threw"*. That fallback does `if (!res.ok) throw` → `toast.error('Failed to delete
food entry')`.

So under a 404 a user retrying after a partial failure would be told the delete failed **when it had
in fact happened**. That is a worse outcome than the inconsistency being fixed.

## 2. Distinguishing the two cases requires leaking that the row exists

From the server the ownership case and the absent case are identical: a scoped UPDATE matching zero
rows. Telling them apart needs an *unscoped* existence probe — which is an enumeration oracle, the
exact shape `errors.ts` and the webhook rule already forbid elsewhere.

**Both current answers are non-leaking, and that is the property that matters.** DELETE says 200 for
absent-or-not-yours; PATCH says 404 for absent-or-not-yours. Neither distinguishes. The two verbs
differing is cosmetic, not a defect — and it is not the case that one of them is wrong.

## 3. The outbox concern I filed turned out not to apply, but the caution was still right

The entry warned that a 404 could be a poison pill because deletes replay through `pushMutations`.
They do — `nutrition-content.tsx:409` queues `domain: 'food_logs'` with `{ id, deleted: true }` — but
that branch calls `this.deleteFoodLog` **directly**, never the HTTP route, so the route's status code
cannot wedge the queue.

Recording that the specific worry was wrong, because the *habit* was not: I wrote "check whether
`food_log` deletes go through `pushMutations` before choosing" rather than guessing, and checking is
what surfaced finding 1, which is the one that actually decides it.

## Nothing changed in code

`invalidUuidResponse` already answers **400** for a malformed id, so the one genuinely wrong status
was never in play. A delete of your own row soft-deletes and answers 200. Every case is already right.

The entry is removed rather than left open, per the protocol for a lead that turns out to be refuted —
and this note is the record that stops it being re-filed from the same observation.

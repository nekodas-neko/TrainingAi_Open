# 2026-09-29 — LA-181: a friend request you sent offered you an Accept that could never work

**Lane B.** Branch `fix/outgoing-friend-requests`. UI only — no migration, no API change, no APK.

## What was wrong

The Manage-friends sheet filtered `status === 'pending'` and gave **every** row Accept/Decline. A
pending row can point either way, and Accept on one you sent always fails — the server accepts only as
the addressee. `RV-195` then made it worse rather than causing it: masking the target of an outgoing
request left the row with no name, so it read *"Unknown"* beside two buttons that cannot work.

The same filter drives the count on the Manage button, so the badge asked you to act on requests you
could not act on. That is the sibling surface, fixed in the same PR.

## Direction comes from the row, not from the viewer

The entry prescribed `f.requesterId === <me>`. Neither the sheet nor its parent is given a viewer id,
so that needs `useSession()` — and a session has a loading state in which **every** row would be
miscategorised, which is worse than the bug.

`maskedForRequester` blanks an outgoing request's name, avatar and friend code but **keeps
`otherUser.id`** (`lib/data/postgres/slices/social.ts`). So whichever end `otherUser` sits on says
which way the request points:

- `otherUser.id === addresseeId` → I sent it.
- otherwise → it is waiting on me.

Exact, no new dependency, no loading state. `splitPendingRequests` is the one place both the sheet and
the badge read, so a count and a list cannot disagree again.

## What the user sees

Incoming rows are unchanged — the requester's name, Accept, Decline. Outgoing rows move to a **Sent**
section reading *"Request sent"* with *"Waiting for them to accept"* under it and a Cancel. There is no
name to show and that is by design, not a gap: `otherUser.displayName` carries what the sender typed
only in the send response, and this list is a later read.

Cancel is the same `DELETE /api/friends/[id]` as removing a friend, which already allows either party —
so the only change is the word: *"Request cancelled"* rather than *"Friend removed"*.

## Verified

- `components/more/__tests__/pending-friend-requests.test.ts` — **7 passed**: outgoing, incoming, both
  fully masked, an accepted row and the self-edge dropped, plus a source guard that the old
  both-directions filter is gone from the sheet *and* the badge.
- **`e2e/la181-outgoing-friend-request.spec.ts` — the entry's own check, run in a browser.** Two
  accounts, one request, both views of it: the sender gets *"Request sent"* + Cancel with **no**
  *"Unknown"* and **no** Accept; the addressee gets *"Accept Test User"* / *"Decline Test User"* and no
  *"Request sent"*. The request is deleted in `afterAll`, and the friendship table read **0 rows**
  afterwards.
- **This one is committed, unlike today's other browser checks.** The budget argument that kept them
  as scratch runs was the 45-minute whole-suite cap, and `LB-166`'s sharding removed it — the slowest
  shard measured 11 minutes of a 25-minute timeout this morning. 33 s for the first coverage of a
  two-user handshake is worth it.
- Full gate: `npx tsc --noEmit`, `pnpm check:rules`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Not exercised

- **The device.** A list split and a label change in a sheet; no native plugin, safe-area, gesture or
  offline-first path.
- **Two real people.** Both accounts are the harness's, on one browser, so nothing here says how the
  request reads to someone who did not just send it.
- **Accept and Decline themselves.** The spec asserts the controls are present and correctly assigned;
  it does not press them, because accepting would consume the request the other test reads. What
  changed is which rows get the buttons, not what the buttons do.

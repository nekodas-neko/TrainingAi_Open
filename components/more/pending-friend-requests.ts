import type { Friendship } from '@trainingai/shared/types/friends'

/**
 * Split pending friendships into the ones waiting on YOU and the ones you sent (LA-181).
 *
 * The sheet used to give every pending row Accept/Decline. Accept on a request you sent always
 * fails — the server accepts only as the addressee — and since `RV-195` the row cannot even name who
 * it was sent to, so it read *"Unknown"* beside two buttons that could not work.
 *
 * Direction comes from the row itself rather than from the viewer's id: `maskedForRequester` blanks
 * the target's name, avatar and friend code for an outgoing request but keeps `otherUser.id`, so
 * whichever end `otherUser` sits on says which way the request points. The alternative — comparing
 * `requesterId` against the session's user id — needs an id this component is not given, and has a
 * loading state in which every row would be miscategorised.
 */
export function splitPendingRequests(friendships: readonly Friendship[]): {
  incoming: Friendship[]
  outgoing: Friendship[]
} {
  const incoming: Friendship[] = []
  const outgoing: Friendship[] = []
  for (const f of friendships) {
    if (f.status !== 'pending' || f.addresseeId === f.requesterId) continue
    if (f.otherUser.id === f.addresseeId) outgoing.push(f)
    else incoming.push(f)
  }
  return { incoming, outgoing }
}

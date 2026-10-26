/**
 * #3369 — what an admin reset or delete cannot do, in one sentence the web dialogs, the Preview
 * dialogs and the docs all use, so they cannot drift apart.
 *
 * The wipe empties the account's own rows and revokes the Oura grant. It does not reach the places
 * the data came from, and those can hand it back: Health Connect keeps its own history window, which
 * the phone re-imports on the next sync; the ring still holds events it never drained, and they
 * arrive when it next connects; Oura Cloud still holds the person's data, and it comes back if they
 * reconnect.
 */
export const OUTSIDE_SOURCES_NOTICE =
  "This cannot stop data coming back from outside sources: Health Connect's history window is imported again on their next sync, events still on their ring arrive when it next connects, and Oura Cloud data returns if they reconnect."

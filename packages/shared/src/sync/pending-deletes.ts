// A server response must never resurrect a row whose delete is still in the outbox.
//
// BF-47, reported from the device: *"Delete worked; when I click delete the item vanishes then
// re-appears; then when you swap screens - it dissapears."* The delete is queued, not yet pushed, so
// the server still holds the row — and any read path that hydrates from or falls back to the server
// copy puts it back until the push lands.
//
// This is CLAUDE.md's own rule: *after an optimistic local write, never apply or cache a server
// response that would replace it.* `applyDelta` already enforces the pull-side half with its
// `sync_status = 'synced'` gate; this is the same gate for a screen-level fetch, which had none.
//
// PURE: no I/O, no clock. The store read that feeds it is deliberately separate, so the rule that
// decides *which* rows to drop can be tested without a device.

/** The shape this reads. `PendingMutation` satisfies it; so does anything else with these two. */
export interface QueuedMutation {
  domain: string
  payload: Record<string, unknown>
}

/**
 * Ids the user has asked to delete in `domain`, from mutations that have not yet been pushed.
 *
 * A delete mutation in this app is `payload: { id, deleted: true }` — the same shape every
 * `pushMutations` delete branch reads, so this cannot drift from what the server will eventually be
 * told. Anything without `deleted: true` is an add or an edit and is left alone: filtering those out
 * of a server response would hide a row the user just created.
 */
export function pendingDeletedIds(
  mutations: readonly QueuedMutation[],
  domain: string,
): Set<string> {
  const ids = new Set<string>()
  for (const m of mutations) {
    if (m.domain !== domain) continue
    if (m.payload?.deleted !== true) continue
    const id = m.payload.id
    if (typeof id === 'string' && id.length > 0) ids.add(id)
  }
  return ids
}

/**
 * `rows` with anything the user has already deleted removed.
 *
 * Takes the id off each row rather than assuming a field name, so the same rule serves a domain
 * whose server shape is not `{ id }`.
 */
export function withoutPendingDeletes<T>(
  rows: readonly T[],
  deletedIds: ReadonlySet<string>,
  idOf: (row: T) => string,
): T[] {
  if (deletedIds.size === 0) return rows as T[]
  return rows.filter(r => !deletedIds.has(idOf(r)))
}

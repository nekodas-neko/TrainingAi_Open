type Enqueue = (
  ops: { domain: 'supplements'; date: string; payload: { id: string; deleted: true } }[],
) => Promise<unknown>;

/**
 * Deletes a supplement and drops its edit-form draft. The draft is cleared only after the delete is
 * queued, so a failed delete keeps what the user typed; once it succeeds the caller closes the edit
 * view, so "Save supplement" can never re-queue an upsert for a deleted id.
 */
export async function deleteSupplement(
  deps: { enqueue: Enqueue; clearDraft: (key: string) => Promise<unknown> },
  date: string,
  id: string,
) {
  await deps.enqueue([{ domain: 'supplements', date, payload: { id, deleted: true } }]);
  await deps.clearDraft(`supplement-editor:${id}`);
}

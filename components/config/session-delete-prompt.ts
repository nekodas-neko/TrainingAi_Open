/**
 * The wording of the session-delete confirmation (BF-132).
 *
 * Kept out of `program-editor-sheet.tsx` so it can be tested without evaluating Radix and dnd-kit
 * under the node test environment, and structural rather than typed to `EditableSession` so the
 * dependency runs one way.
 */

/** Falls back rather than rendering an empty name: a session can be added and not yet named. */
export function sessionLabel(session: { name: string }): string {
  return session.name.trim() || "Untitled session";
}

/**
 * The exercise count is the part that carries the warning — a generic "Are you sure?" trains the
 * reflex to dismiss it, which on a delete this expensive is worse than no dialog at all.
 */
export function sessionDeletePrompt(session: { name: string; exercises: unknown[] }): string {
  const n = session.exercises.length;
  if (n === 0) return `Delete ${sessionLabel(session)}?`;
  return `Delete ${sessionLabel(session)} and its ${n} ${n === 1 ? "exercise" : "exercises"}?`;
}

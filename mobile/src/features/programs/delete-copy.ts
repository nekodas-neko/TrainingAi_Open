/**
 * What the program delete confirmation says. It states what `deleteProgram` really removes
 * (lib/data/postgres/slices/programs.ts and the schema's cascades): the program row, which takes
 * its sessions, their exercises, its schedule, its volume targets and its stored plan rows with it,
 * plus the phase set made for this program. A logged workout is not deleted: its link to the
 * program session is cleared (`workout_sessions.session_id` is `ON DELETE SET NULL`).
 */
export function deleteProgramMessage(): string {
  return 'This removes the program, its sessions and exercises, its schedule, and the phase set made for it. Workouts you have already logged stay in your history.';
}

/** The other two kinds keep their old line; only the program's cascade has been checked. */
export function deleteItemMessage(): string {
  return 'This removes the selected item from your account.';
}

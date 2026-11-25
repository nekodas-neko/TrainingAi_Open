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

/** The Program screen's injuries row: how many are active, and where they are managed. */
export function injuriesSubtitle(active: number | undefined): string {
  const where = 'Add or update them in Health › Body';
  if (active === undefined) return where;
  return `${active === 0 ? 'No active injuries' : active === 1 ? '1 active injury' : `${active} active injuries`} · ${where}`;
}

/** The Delete button's spoken name: it starts with the visible "Delete program" so a voice command matches it. */
export const DELETE_PROGRAM_TITLE = 'Delete program';
export function deleteProgramLabel(programName: string): string {
  return `${DELETE_PROGRAM_TITLE} ${programName}`;
}

/** The Injuries row's spoken name: the visible title and subtitle, in reading order. */
export const INJURIES_ROW_TITLE = 'Injuries';
export function injuriesRowLabel(active: number | undefined): string {
  return `${INJURIES_ROW_TITLE}, ${injuriesSubtitle(active)}`;
}

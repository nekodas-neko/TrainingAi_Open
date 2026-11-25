/** The words the logger shows around skipping, kept apart from the screen so they can be tested (#4143). */
export function skipExerciseMessage(exerciseName: string, solo: boolean): string {
  return `Skip ${exerciseName}? Sets you have already logged on it stay saved. ${
    solo ? 'You go back to the session.' : 'You move on to the next exercise.'
  }`;
}

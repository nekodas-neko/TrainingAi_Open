// The hand-off test card is a developer surface (#2896). It shows only in the Dev build, never in
// the real app or in TrainingAi Preview (#3021). A missing application id hides it too.
export const HANDOFF_DEBUG_APPLICATION_IDS: readonly string[] = ['com.trainingai.app.dev'];

export function isHandoffDebugBuild(applicationId: string | null | undefined): boolean {
  return applicationId != null && HANDOFF_DEBUG_APPLICATION_IDS.includes(applicationId);
}

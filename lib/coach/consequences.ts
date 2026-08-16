import type { CoachPatch } from './patch'
import { fieldsMatchDomain } from './patch'
import { handlerFor } from './apply'
import type { Db, PreviewResult } from './domains/types'

export type { Consequence, ConsequenceKind, Drift, PreviewResult } from './domains/types'

/**
 * What a patch actually costs, measured rather than described.
 *
 * The model never authors these — `ChangePreviewSchema` has no field for a consequence, so it
 * cannot even try. It proposes a patch; this runs against the real rows; the client renders the
 * measurement. "This drops your weekly lower-back sets" is a claim about someone's training that
 * they cannot check, so it has to be a measurement or it should not be on screen.
 *
 * Also returns drift, so a stale proposal says so on render rather than only on Apply.
 */
export async function previewPatch(
  db: Db,
  userId: string,
  patch: CoachPatch,
  today?: string,
): Promise<PreviewResult> {
  if (!fieldsMatchDomain(patch)) return { consequences: [], drift: [], target: null }
  return handlerFor(patch.domain, today).preview(db, userId, patch)
}

// The exercise-log edit and delete for `PATCH`/`DELETE /api/workout-entry`: look up the repository
// and run the `*WithRepo` writes (`./exercise-log-edits-core`), which the outbox push calls with its
// own (#3916).
import { getRepository } from '@/lib/data'
import type { EditStamp } from '@trainingai/shared/sync/edited-at'
import { editExerciseLogWithRepo, deleteExerciseLogWithRepo, type ExerciseLogEdit } from './exercise-log-edits-core'

export {
  ExerciseLogEditSchema, ExerciseLogDeleteSchema, editExerciseLogWithRepo, deleteExerciseLogWithRepo,
  type ExerciseLogEdit,
} from './exercise-log-edits-core'

export async function editExerciseLog(
  userId: string, edit: ExerciseLogEdit, stamp?: EditStamp,
): ReturnType<typeof editExerciseLogWithRepo> {
  return editExerciseLogWithRepo(await getRepository(), userId, edit, stamp)
}

export async function deleteExerciseLog(userId: string, exerciseLogId: string): ReturnType<typeof deleteExerciseLogWithRepo> {
  return deleteExerciseLogWithRepo(await getRepository(), userId, exerciseLogId)
}

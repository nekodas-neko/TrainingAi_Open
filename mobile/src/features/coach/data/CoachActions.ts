import { z } from 'zod';
import type { WorkoutResources } from '../../workouts/data/WorkoutResources.ts';
import {
  CoachPatchSchema,
  fieldsMatchDomain,
  hasUniqueChangeIds,
  type CoachPatch,
} from './patch.ts';
import { applySchema, coachPaths, historySpec, previewSchema } from './models.ts';
import { ApiError } from '../../account/api/client.ts';

export class CoachActions {
  private writing = false;
  constructor(
    readonly resources: WorkoutResources,
    private onChanged: () => void,
    private pending: (domain: CoachPatch['domain']) => boolean = () => false,
  ) {}
  async preview(patch: CoachPatch) {
    return previewSchema.parse(
      await this.resources.connection.post('/api/coach/preview', CoachPatchSchema.parse(patch)),
    );
  }
  async apply(patch: CoachPatch, acceptedChangeIds: string[]) {
    const valid = CoachPatchSchema.parse(patch);
    if (this.pending(valid.domain)) throw new ApiError(409, 'pending_local_changes');
    if (
      ['session_exercise', 'program_phase', 'early_deload', 'injury'].includes(valid.domain) &&
      (this.resources.changes.pendingFor('/api/workout-templates').length ||
        this.resources.changes.pendingFor('/api/injuries').length)
    ) {
      throw new ApiError(409, 'pending_local_changes');
    }
    if (
      !fieldsMatchDomain(valid) ||
      !hasUniqueChangeIds(valid) ||
      !acceptedChangeIds.length ||
      new Set(acceptedChangeIds).size !== acceptedChangeIds.length ||
      acceptedChangeIds.some((id) => !valid.changes.some((change) => change.id === id))
    ) {
      throw new Error('Ask Coach for a fresh suggestion.');
    }
    if (this.writing) return null;
    this.writing = true;
    try {
      const result = applySchema.parse(
        await this.resources.connection.post('/api/coach/apply', {
          patch: valid,
          acceptedChangeIds,
        }),
      );
      this.changed();
      return result;
    } finally {
      this.writing = false;
    }
  }
  async undo(id: string) {
    if (this.writing) return false;
    this.writing = true;
    try {
      await this.resources.connection.post(`/api/coach/apply/${z.uuid().parse(id)}/undo`, {});
      const history = this.resources.state(historySpec).data;
      if (history)
        await this.resources
          .replace(historySpec, {
            ...history,
            changes: history.changes.map((change) =>
              change.id === id ? { ...change, undoneAt: new Date().toISOString() } : change,
            ),
          })
          .catch(() => {});
      this.changed();
      return true;
    } finally {
      this.writing = false;
    }
  }
  private changed() {
    this.resources.invalidate(coachPaths);
    this.onChanged();
    void this.resources.refreshVisible();
  }
}

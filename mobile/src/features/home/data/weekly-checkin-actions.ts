import { ApiError } from '../../account/api/client.ts';
import { isConnectionFailure } from '../../../core/sync/Connectivity.ts';
import { failureNotice } from '../../../core/reporting/index.ts';
import { coachPaths } from '../../coach/data/models.ts';
import type { ResourceSpec, WorkoutResources } from '../../workouts/data/WorkoutResources.ts';
import {
  CHECKIN_PATH,
  checkinStateSchema,
  saveOutcomeSchema,
  type CheckinState,
  type OfferAction,
  type SaveNotes,
  type UndoTarget,
  type saveBody,
} from './weekly-checkin.ts';

export type CheckinResult = { ok: true; notes?: SaveNotes } | { ok: false; message: string | null };

export const OFFLINE_MESSAGE =
  'You’re offline. Nothing was sent; your answers stay here. Save when you’re back online.';
const LOST_MESSAGE =
  'The connection dropped, so this may not have reached the server. Your answers stay here; try again. Sending again never applies a change twice.';
const PENDING_MESSAGE = 'Changes made on this phone are still syncing. Try again in a moment.';

type Resources = Pick<WorkoutResources, 'write' | 'replace' | 'load'> & {
  changes: Pick<WorkoutResources['changes'], 'pendingFor'>;
};

/**
 * The check-in's writes. Each goes straight to the server and is never queued: what a save does is
 * worked out there from the week's logs at that moment, and the result screen shows only what the
 * server reports, so a save queued offline would have nothing true to show and could land after the
 * week's window closed. While the phone knows it is offline, nothing is sent and the answers stay in
 * the sheet. A save whose answer was lost in transit is safe to send again: the engine's redo
 * updates the same row and never stacks a second lowering.
 *
 * After every call the cached state is replaced by the one the route returned. A refusal (409, 404)
 * shows the server's own sentence and reloads the state.
 */
export class WeeklyCheckinActions {
  private busy = false;
  constructor(
    private resources: Resources,
    private spec: ResourceSpec<CheckinState>,
    private onChanged: () => void,
    private isOffline: () => boolean,
  ) {}
  save(body: ReturnType<typeof saveBody>) {
    return this.run(`${CHECKIN_PATH}/save`, body, (response) => {
      const outcome = saveOutcomeSchema.parse(response);
      return { state: outcome.state, notes: { kept: outcome.kept, notApplied: outcome.notApplied } };
    });
  }
  offer(checkinId: string, offer: OfferAction, decision: 'accept' | 'decline') {
    if (
      decision === 'accept' &&
      offer.kind !== 'step_up' &&
      (this.resources.changes.pendingFor('/api/workout-templates').length ||
        this.resources.changes.pendingFor('/api/injuries').length)
    ) {
      return Promise.resolve<CheckinResult>({ ok: false, message: PENDING_MESSAGE });
    }
    return this.run(`${CHECKIN_PATH}/offer`, { checkinId, decision, offer }, (response) => ({
      state: checkinStateSchema.parse(response),
    }));
  }
  undo(checkinId: string, target: UndoTarget) {
    return this.run(`${CHECKIN_PATH}/undo`, { checkinId, target }, (response) => ({
      state: checkinStateSchema.parse(response),
    }));
  }
  private async run(
    path: string,
    body: unknown,
    read: (response: unknown) => { state: CheckinState; notes?: SaveNotes },
  ): Promise<CheckinResult> {
    if (this.busy) return { ok: false, message: null };
    if (this.isOffline()) return { ok: false, message: OFFLINE_MESSAGE };
    this.busy = true;
    try {
      const response = await this.resources.write('POST', path, body, coachPaths);
      const { state, notes } = read(response);
      await this.resources.replace(this.spec, state).catch(() => {});
      this.onChanged();
      return notes ? { ok: true, notes } : { ok: true };
    } catch (failure) {
      if (failure instanceof ApiError && (failure.status === 409 || failure.status === 404)) {
        void this.resources.load(this.spec, true);
        return {
          ok: false,
          message:
            failure.serverMessage ??
            (failure.status === 404
              ? 'That is no longer there. The check-in has been refreshed.'
              : 'The check-in changed. It has been refreshed.'),
        };
      }
      if (isConnectionFailure(failure)) return { ok: false, message: LOST_MESSAGE };
      return { ok: false, message: failureNotice('Could not reach the weekly check-in.', failure) };
    } finally {
      this.busy = false;
    }
  }
}

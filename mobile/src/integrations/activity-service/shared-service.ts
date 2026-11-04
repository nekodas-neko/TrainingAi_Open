import type {
  ActivityServiceStarter,
  BackgroundNotification,
  BackgroundStarted,
} from '../../features/activities/data/background-recording';

/**
 * The clock the activity notification shows (#3626): `startedAt` is the instant the elapsed time
 * counts from (the start moved on by the time already paused), and `pausedElapsedMs` the frozen
 * elapsed time while paused, null while running. Built by `activityClock` in ActivityStore.
 */
export type ServiceClock = { startedAt: number; pausedElapsedMs: number | null };
export type ServiceNotification = BackgroundNotification & { clock?: ServiceClock | null };

/** `modules/activity-service`: a clock goes over as two numbers, null for none. */
export type NativeActivityService = {
  start(
    title: string,
    body: string,
    clockStartedAt: number | null,
    clockPausedMs: number | null,
  ): Promise<'on' | 'failed' | 'skipped'>;
  show(title: string, body: string, clockStartedAt: number | null, clockPausedMs: number | null): Promise<void>;
  clear(): Promise<void>;
  stop(): Promise<void>;
};

/** Who may hold the connected-device service: an activity (#3595) or a gym workout (#3627). */
export type ServiceClaimant = 'activity' | 'workout';
// The notification shown when both hold it: the activity's, which carries the clock.
const PRIORITY: ServiceClaimant[] = ['activity', 'workout'];

export type ActivityServiceHost = {
  /** The starter one claimant uses; each start is one counted hold, released by its own stop. */
  starter(claimant: ServiceClaimant): ActivityServiceStarter;
  /**
   * What the claimant's notification says now (the clock moving to a pause, say), or null when it
   * has nothing to show. It goes on the service's notification while the service runs, else on a
   * notification of its own: a GPS recording's service is expo-location's, whose text is fixed.
   */
  notify(claimant: ServiceClaimant, notification: ServiceNotification | null): void;
};

const ignore = () => {};
const nativeArgs = (n: ServiceNotification) =>
  [n.title, n.body, n.clock?.startedAt ?? null, n.clock?.pausedElapsedMs ?? null] as const;

/**
 * One connected-device service for everyone who needs the app kept alive with the screen off,
 * counted as `StrapSession.holdAccelerometer` counts its readers (#3599): the first hold starts it,
 * the last release stops it, and a release in between leaves it running for the others. A gym
 * workout and an indoor activity at once share it rather than one stopping it under the other.
 */
export function createActivityServiceHost(native: NativeActivityService): ActivityServiceHost {
  const holders = new Map<ServiceClaimant, { token: object; notification: ServiceNotification }>();
  const notes = new Map<ServiceClaimant, ServiceNotification>();
  let service: 'off' | 'starting' | 'on' = 'off';
  let starting: Promise<'on' | 'failed' | 'skipped'> | null = null;
  // What the notification on screen says, so an unchanged update sends nothing.
  let posted: string | null = null;

  const top = () => {
    for (const claimant of PRIORITY) {
      const notification = notes.get(claimant) ?? holders.get(claimant)?.notification;
      if (notification) return notification;
    }
    return null;
  };
  const reconcile = () => {
    // The start posts its own notification; what changed meanwhile goes once it has answered.
    if (service === 'starting') return;
    const notification = top();
    if (!notification) {
      if (posted !== null) {
        posted = null;
        void native.clear().catch(ignore);
      }
      return;
    }
    const key = JSON.stringify(nativeArgs(notification));
    if (key === posted) return;
    posted = key;
    void native.show(...nativeArgs(notification)).catch(ignore);
  };
  const startService = () => {
    service = 'starting';
    const first = top()!;
    posted = JSON.stringify(nativeArgs(first));
    return native
      .start(...nativeArgs(first))
      .catch(() => 'failed' as const)
      .then(async (result) => {
        starting = null;
        if (result === 'on' && holders.size === 0) {
          // Everyone let go while Android was answering.
          service = 'off';
          posted = null;
          await native.stop().catch(ignore);
        } else {
          service = result === 'on' ? 'on' : 'off';
          if (result !== 'on') posted = null;
        }
        reconcile();
        return result;
      });
  };
  const release = async (claimant: ServiceClaimant, token: object) => {
    if (holders.get(claimant)?.token !== token) return;
    holders.delete(claimant);
    if (holders.size === 0 && service === 'on') {
      service = 'off';
      posted = null;
      // Stopped before anything else is shown: the plain notification must not land first and
      // go with the service's.
      await native.stop().catch(ignore);
    }
    reconcile();
  };

  // A plain notification left by a process that was killed mid-activity; a live one is re-sent.
  void native.clear().catch(ignore);

  return {
    starter: (claimant) => ({
      async start({ notification }): Promise<BackgroundStarted> {
        const token = {};
        holders.set(claimant, { token, notification });
        let result: 'on' | 'failed' | 'skipped';
        if (service === 'on') {
          result = 'on';
          reconcile();
        } else {
          starting ??= startService();
          result = await starting;
        }
        if (result !== 'on') {
          if (holders.get(claimant)?.token === token) holders.delete(claimant);
          return { result };
        }
        return { result: 'on', stop: () => release(claimant, token) };
      },
    }),
    notify(claimant, notification) {
      if (notification) notes.set(claimant, notification);
      else notes.delete(claimant);
      reconcile();
    },
  };
}

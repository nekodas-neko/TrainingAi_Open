// The strap link's reconnect state machine. Pure: the session applies the effect it returns.
//
// The current app's strap service gives up after six failures (~4 min) because outside a workout an
// unreachable strap usually just is not being worn. Here the link is only wanted while a workout or
// the Devices screen holds it, so it keeps retrying at the last step for as long as it is wanted: a
// strap that drops mid-workout comes back on its own when it is back in range.
export const RECONNECT_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const;

export type LinkPhase = 'idle' | 'connecting' | 'connected' | 'waiting' | 'radioOff';
export type LinkState = {
  phase: LinkPhase;
  /** Failed attempts since the last good connection; picks the next delay. */
  attempt: number;
  wanted: boolean;
  radioOn: boolean;
};
export type LinkEvent =
  | { type: 'want' }
  | { type: 'unwant' }
  | { type: 'connected' }
  /** A connect attempt failed, or an established link dropped. */
  | { type: 'lost' }
  | { type: 'timer' }
  /** The user asked to try now. */
  | { type: 'retry' }
  | { type: 'radio'; on: boolean };
export type LinkEffect =
  | { type: 'none' }
  | { type: 'connect' }
  | { type: 'disconnect' }
  | { type: 'wait'; ms: number };

export const initialLink: LinkState = { phase: 'idle', attempt: 0, wanted: false, radioOn: true };

const none = { type: 'none' } as const;
const connect = (state: LinkState) => ({
  state: { ...state, phase: 'connecting' as const },
  effect: { type: 'connect' } as const,
});

export function linkStep(
  state: LinkState,
  event: LinkEvent,
): { state: LinkState; effect: LinkEffect } {
  switch (event.type) {
    case 'want': {
      const next = { ...state, wanted: true };
      if (state.phase === 'idle' || state.phase === 'waiting')
        return next.radioOn
          ? connect({ ...next, attempt: 0 })
          : { state: { ...next, phase: 'radioOff' }, effect: none };
      return { state: next, effect: none };
    }
    case 'unwant': {
      const next = { ...state, wanted: false, attempt: 0, phase: 'idle' as const };
      const linked = state.phase === 'connected' || state.phase === 'connecting';
      return { state: next, effect: linked ? { type: 'disconnect' } : none };
    }
    case 'connected':
      if (!state.wanted)
        return { state: { ...state, phase: 'idle' }, effect: { type: 'disconnect' } };
      return { state: { ...state, phase: 'connected', attempt: 0 }, effect: none };
    case 'lost': {
      if (!state.wanted) return { state: { ...state, phase: 'idle' }, effect: none };
      if (!state.radioOn) return { state: { ...state, phase: 'radioOff' }, effect: none };
      const ms = RECONNECT_DELAYS_MS[Math.min(state.attempt, RECONNECT_DELAYS_MS.length - 1)];
      return {
        state: { ...state, phase: 'waiting', attempt: state.attempt + 1 },
        effect: { type: 'wait', ms },
      };
    }
    case 'timer':
      return state.phase === 'waiting' && state.wanted ? connect(state) : { state, effect: none };
    case 'retry':
      return state.wanted && state.radioOn && state.phase === 'waiting'
        ? connect({ ...state, attempt: 0 })
        : { state, effect: none };
    case 'radio': {
      const next = { ...state, radioOn: event.on };
      if (!event.on)
        return state.phase === 'idle'
          ? { state: next, effect: none }
          : { state: { ...next, phase: 'radioOff' }, effect: none };
      return state.phase === 'radioOff' && state.wanted
        ? connect({ ...next, attempt: 0 })
        : { state: next, effect: none };
    }
  }
}

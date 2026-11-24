// Whether a deload the lifter asked for (or the plan prescribed) is on screen yet (#4104 review).
// The header, the Start label and the type a workout records all follow this, never the tap: until
// the deload's own rows have loaded and are deloaded, the card is still the full plan.

export type DeloadChoiceInput = {
  /** The lifter asked for it, or the plan prescribed it and it was adopted. */
  requested: boolean;
  /** The plan prescribes a deload today: its rows already arrive deloaded on the full read. */
  prescribedDeload: boolean;
  /** The rows of the deload read (`aiDeload=1`), once it has arrived. */
  deloadRows: readonly { deloaded: boolean }[] | undefined;
  /** The rows of the full read. */
  fullRows: readonly { deloaded: boolean }[] | undefined;
  /** The deload read's state. */
  read: { connected: boolean; loading: boolean; refreshing: boolean; error: string | null };
};

export type DeloadChoice = {
  /** Draw the deload: header, Start deload, its rows. */
  ready: boolean;
  /** idle: nothing asked or ready. loading: asked, not here yet. failed: asked, will not arrive. */
  status: 'idle' | 'loading' | 'failed';
};

export const DELOAD_FAILED = 'Could not load the deload. You are on the full plan.';

export function deloadChoice(input: DeloadChoiceInput): DeloadChoice {
  if (!input.requested) {
    return { ready: false, status: 'idle' };
  }
  const rows = input.deloadRows ?? (input.prescribedDeload ? input.fullRows : undefined);
  if (rows?.some((row) => row.deloaded)) {
    return { ready: true, status: 'idle' };
  }
  const { connected, loading, refreshing, error } = input.read;
  return {
    ready: false,
    status: connected && (loading || refreshing) && !error ? 'loading' : 'failed',
  };
}

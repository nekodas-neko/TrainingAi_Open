import { LADDER_CLASS } from '@trainingai/shared/collection/sprites';
import type { FaucetKey } from '@trainingai/shared/collection/summary';
import { catArt } from './catArt.generated';

export { catArt };

/** The still art for a ladder tier, or undefined past the top of the drawn set. */
export const catArtFor = (faucet: FaucetKey, tier: number) =>
  catArt[`${LADDER_CLASS[faucet]}-${tier + 1}`];

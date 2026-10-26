import { capitalize } from '@trainingai/shared/format/capitalize';
import { V2_LADDERS } from '@trainingai/shared/collection/ladder';
import {
  FAUCET_ORDER,
  FAUCET_TITLE,
  ROSTER_SHOWN,
  cardDecayLine,
  decayLine,
  heldLabel,
  lostLine,
  mergeCountLine,
  mergeLine,
  nearestMerge,
  nextMerge,
  restlessLine,
  shortDay,
  totalHeld,
  type FaucetKey,
} from '@trainingai/shared/collection/summary';
import type { Collections } from './models.ts';

/** Pips beside the Home card's merge line stop here, so a seven-cost ladder still fits. */
const MAX_PIPS = 7;

export type CardModel =
  | { kind: 'empty'; restless: string | null; text: string }
  | {
      kind: 'merge';
      restless: string | null;
      /** The tier being worked toward, first letter capitalised. */
      toward: string;
      count: string;
      have: number;
      need: number;
      shown: number;
      note: string | null;
    };

/** What the Home card says: one ladder, the one nearest its next merge, and a line for what is at risk. */
export function cardModel(collections: Collections): CardModel {
  const next = nearestMerge(collections, V2_LADDERS);
  const restless = restlessLine(collections);
  if (next === null) {
    const held = FAUCET_ORDER.reduce(
      (sum, faucet) => sum + totalHeld(collections[faucet]),
      0,
    );
    return {
      kind: 'empty',
      restless,
      text:
        held > 0
          ? `${held} in your collection.`
          : 'Train, walk or sleep and your first cat turns up.',
    };
  }
  const state = collections[next.faucet];
  return {
    kind: 'merge',
    restless,
    toward: capitalize(next.towardName),
    count: mergeCountLine(next),
    have: next.have,
    need: next.need,
    shown: Math.min(next.need, MAX_PIPS),
    // The named cat that left, if the fold knows it; otherwise the lifetime count of those who did.
    note: lostLine(state) ?? cardDecayLine(state.decayEvents),
  };
}

export interface LadderModel {
  faucet: FaucetKey;
  title: string;
  /** Marked provisional on its own row (the owner marked the Rogue's numbers provisional). */
  provisional: boolean;
  held: string;
  /** `cost` is what it takes of the tier below to make one of this tier; 0 for the bottom tier. */
  tiers: { name: string; numeral: string; count: number; cost: number }[];
  merge: string | null;
  roster: { id: string; tier: number; name: string; tierName: string; detail: string }[];
  more: number;
  /** Every cat held, the N in "Show all N": the roster rows plus those past the cap. */
  total: number;
  decay: string | null;
}

/** One row of the collection screen: the tier chain, the next merge, the named cats behind a tap, the decay line. */
export function ladderModel(faucet: FaucetKey, collections: Collections): LadderModel {
  const ladder = V2_LADDERS[faucet];
  const state = collections[faucet];
  const next = nextMerge(state, ladder);
  const cats = state.cats ?? [];
  return {
    faucet,
    title: FAUCET_TITLE[faucet],
    provisional: faucet === 'cardio',
    held: heldLabel(totalHeld(state)),
    tiers: ladder.tiers.map((tier, i) => ({
      name: capitalize(tier.name),
      // Tier names end in their numeral ("Tank III"); the chain has room for only that.
      numeral: tier.name.split(' ').pop() ?? '',
      count: state.stock[i] ?? 0,
      cost: tier.mergeCost,
    })),
    merge: next ? mergeLine(next) : null,
    roster: cats.slice(0, ROSTER_SHOWN).map((cat) => ({
      id: cat.id,
      tier: cat.tier,
      name: cat.name,
      tierName: capitalize(ladder.tiers[cat.tier]?.name ?? ''),
      // The day it arrived. What it was merged from is left out: those cats no longer exist (#2088).
      detail: shortDay(cat.born),
    })),
    more: Math.max(0, cats.length - ROSTER_SHOWN),
    total: cats.length,
    decay: decayLine(state.decayEvents),
  };
}

export const ladderModels = (collections: Collections) =>
  FAUCET_ORDER.map((faucet) => ladderModel(faucet, collections));

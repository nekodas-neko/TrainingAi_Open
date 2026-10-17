// The grouping lives in `packages/shared/src/health/movement-balance.ts` so the native app reads
// the same one (#2900). Kept as a name here so the card and its tests need no edit.
export {
  PATTERN_ORDER,
  PATTERN_LABEL,
  movementBalance,
  type MovementBalance,
  type MovementBalanceRow,
} from '@trainingai/shared/health/movement-balance'

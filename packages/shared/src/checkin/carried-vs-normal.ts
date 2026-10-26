/**
 * The comparison answer a morning-sheet save keeps. The sheet no longer shows the "vs normal" row
 * (#3334), but Home's readiness card (#2106) stores its Better / Same / Worse answer there, and a
 * check-in save writes the whole row, so the sheet carries the saved answer through rather than
 * writing null over it. One copy for the current app's sheet and Preview's.
 */
export function carriedVsNormal(
  row: { vsNormal?: unknown; vsQuestion?: unknown; vsNormalTouched?: unknown } | null | undefined,
) {
  return {
    vsNormal: (['better', 'same', 'worse'] as const).find((feel) => feel === row?.vsNormal) ?? null,
    // Absent, not null: the schema takes 1 or 2 and nothing else.
    ...(row?.vsQuestion === 1
      ? { vsQuestion: 1 as const }
      : row?.vsQuestion === 2
        ? { vsQuestion: 2 as const }
        : {}),
    vsNormalTouched: row?.vsNormalTouched === true,
  }
}

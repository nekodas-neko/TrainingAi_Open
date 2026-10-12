import type { AppleSampleType } from '@trainingai/shared/validation/apple-health-import';
export async function readAppleImportPage(
  _type: AppleSampleType,
  _from: string,
  _anchor?: string,
) {
  return null as {
    samples: import('@trainingai/shared/validation/apple-health-import').AppleImportBatch['samples'];
    deleted: string[];
    anchor: string;
    more: boolean;
    skipped: number;
  } | null;
}

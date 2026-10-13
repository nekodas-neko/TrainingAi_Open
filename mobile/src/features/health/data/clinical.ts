import { z } from 'zod';
import { isCalendarDate } from '@trainingai/shared/date-utils';
export const rmrSchema = z
  .object({
    measuredOn: z
      .string()
      .regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/)
      .refine(isCalendarDate, 'Not a real calendar date'),
    rmrKcal: z.number().int().min(500).max(5000),
    ffmKgAtTest: z.number().min(10).max(200).nullish(),
    weightKgAtTest: z.number().min(20).max(400).nullish(),
    method: z.string().max(120).nullish(),
    provider: z.string().max(200).nullish(),
    notes: z.string().max(2000).nullish(),
  })
  .strict();
const pct = z.number().min(0).max(100).nullish();
const grams = z.number().min(0).max(500000).nullish();
const ratio = z.number().min(0).max(100).nullish();
const RegionSchema = z
  .object({
    region: z.string().min(1).max(60),
    bmd: z.number().min(0).max(10).nullish(),
    bmcG: grams,
    areaCm2: z.number().min(0).max(10000).nullish(),
  })
  .strict();
export const dexaSchema = z
  .object({
    scannedOn: z
      .string()
      .regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/)
      .refine(isCalendarDate, 'Not a real calendar date'),
    manufacturer: z.string().max(120).nullish(),
    model: z.string().max(120).nullish(),
    serialNumber: z.string().max(120).nullish(),
    scanType: z.string().max(200).nullish(),
    analysisVersion: z.string().max(60).nullish(),
    providerScanId: z.string().max(120).nullish(),
    heightCm: z.number().min(50).max(280).nullish(),
    weightKg: z.number().min(20).max(400).nullish(),
    ageYears: z.number().int().min(0).max(130).nullish(),
    bmi: z.number().min(5).max(100).nullish(),
    totalBmd: z.number().min(0).max(10).nullish(),
    tScore: z.number().min(-15).max(15).nullish(),
    zScore: z.number().min(-15).max(15).nullish(),
    totalBmcG: grams,
    bmdPrecisionCvPct: pct,
    fatG: grams,
    leanG: grams,
    leanPlusBmcG: grams,
    totalMassG: grams,
    pctFat: pct,
    pctFatYoungNormal: z.number().int().min(0).max(100).nullish(),
    pctFatAgeMatched: z.number().int().min(0).max(100).nullish(),
    androidPctFat: pct,
    gynoidPctFat: pct,
    fatMassHeight2: z.number().min(0).max(100).nullish(),
    androidGynoidRatio: ratio,
    pctFatTrunkLegs: ratio,
    trunkLimbFatMassRatio: ratio,
    vatMassG: grams,
    vatVolumeCm3: z.number().min(0).max(100000).nullish(),
    vatAreaCm2: z.number().min(0).max(10000).nullish(),
    leanHeight2: z.number().min(0).max(100).nullish(),
    appendicularLeanHeight2: z.number().min(0).max(100).nullish(),
    boneReference: z.string().max(200).nullish(),
    bodyCompReference: z.string().max(200).nullish(),
    source: z.enum(['manual', 'extracted']).optional(),
    notes: z.string().max(4000).nullish(),
    regions: z.array(RegionSchema).max(40).optional(),
  })
  .strict();
export const rmrSpec = {
  path: '/api/measured-rmr',
  ttl: 300000,
  schema: z.object({ tests: z.array(rmrSchema.passthrough()) }),
};
export const dexaSpec = {
  path: '/api/dexa-scans',
  ttl: 300000,
  schema: z.object({ scans: z.array(dexaSchema.passthrough()) }),
};
export const clinicalDraftSchema = z.record(z.string(), z.string());
export function clinicalPayload(kind: 'rmr' | 'dexa', fields: Record<string, string>) {
  const schema = kind === 'rmr' ? rmrSchema : dexaSchema;
  const date = kind === 'rmr' ? 'measuredOn' : 'scannedOn';
  const payload: Record<string, unknown> = {};
  const textFields = new Set([
    'method',
    'provider',
    'notes',
    'manufacturer',
    'model',
    'serialNumber',
    'scanType',
    'analysisVersion',
    'providerScanId',
    'boneReference',
    'bodyCompReference',
  ]);
  for (const [key, value] of Object.entries(fields)) {
    if (key === date) {
      payload[key] = value.trim();
    } else if (textFields.has(key)) {
      payload[key] = value.trim() || null;
    } else if (value.trim()) {
      payload[key] = Number(value);
    }
  }
  if (kind === 'dexa') {
    payload.source = 'manual';
  }
  return schema.parse(payload);
}

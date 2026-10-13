export type ClinicalField = {
  key: string;
  label: string;
  unit?: string;
  hint?: string;
  text?: boolean;
};
export const clinicalFields: Record<'rmr' | 'dexa', Record<string, ClinicalField[]>> = {
  rmr: {
    '': [
      {
        key: 'rmrKcal',
        label: 'Measured RMR',
        unit: 'kcal/day',
        hint: 'The measured resting rate, not the predicted one the report prints beside it.',
        text: false,
      },
      {
        key: 'ffmKgAtTest',
        label: 'Fat-free mass at test',
        unit: 'kg',
        hint: 'From the DEXA taken with it (Lean + BMC). Without this the measurement cannot be re-scaled as your lean mass changes, so it ages instead of tracking you.',
        text: false,
      },
    ],
    'Other details': [
      {
        key: 'weightKgAtTest',
        label: 'Weight at test',
        unit: 'kg',
        text: false,
      },
      {
        key: 'method',
        label: 'Method',
        text: true,
      },
      {
        key: 'provider',
        label: 'Provider',
        text: true,
      },
      {
        key: 'notes',
        label: 'Notes',
        text: true,
      },
    ],
  },
  dexa: {
    '': [
      {
        key: 'pctFat',
        label: 'Total body fat',
        unit: '%',
        hint: 'The one figure the app reads today — it calibrates your scale against this scan.',
        text: false,
      },
      {
        key: 'weightKg',
        label: 'Weight at scan',
        unit: 'kg',
        text: false,
      },
    ],
    'Body composition': [
      {
        key: 'fatG',
        label: 'Fat',
        unit: 'g',
        text: false,
      },
      {
        key: 'leanG',
        label: 'Lean',
        unit: 'g',
        text: false,
      },
      {
        key: 'leanPlusBmcG',
        label: 'Lean + BMC (fat-free mass)',
        unit: 'g',
        text: false,
      },
      {
        key: 'totalMassG',
        label: 'Total mass',
        unit: 'g',
        text: false,
      },
      {
        key: 'androidPctFat',
        label: 'Android fat',
        unit: '%',
        text: false,
      },
      {
        key: 'gynoidPctFat',
        label: 'Gynoid fat',
        unit: '%',
        text: false,
      },
      {
        key: 'pctFatYoungNormal',
        label: 'Young normal',
        unit: 'percentile',
        hint: 'A percentile, not a percentage — the report prints both and they look alike.',
        text: false,
      },
      {
        key: 'pctFatAgeMatched',
        label: 'Age matched',
        unit: 'percentile',
        text: false,
      },
    ],
    Bone: [
      {
        key: 'totalBmd',
        label: 'Total BMD',
        unit: 'g/cm²',
        text: false,
      },
      {
        key: 'tScore',
        label: 'T-score',
        hint: 'Negative is normal here — these are standard deviations.',
        text: false,
      },
      {
        key: 'zScore',
        label: 'Z-score',
        text: false,
      },
      {
        key: 'totalBmcG',
        label: 'Total BMC',
        unit: 'g',
        text: false,
      },
      {
        key: 'bmdPrecisionCvPct',
        label: 'BMD precision (CV)',
        unit: '%',
        text: false,
      },
    ],
    'Adipose & lean indices': [
      {
        key: 'fatMassHeight2',
        label: 'Fat mass / height²',
        unit: 'kg/m²',
        text: false,
      },
      {
        key: 'androidGynoidRatio',
        label: 'Android / gynoid ratio',
        text: false,
      },
      {
        key: 'pctFatTrunkLegs',
        label: '% fat trunk / legs',
        text: false,
      },
      {
        key: 'trunkLimbFatMassRatio',
        label: 'Trunk / limb fat mass',
        text: false,
      },
      {
        key: 'vatMassG',
        label: 'Est. VAT mass',
        unit: 'g',
        text: false,
      },
      {
        key: 'vatVolumeCm3',
        label: 'Est. VAT volume',
        unit: 'cm³',
        text: false,
      },
      {
        key: 'vatAreaCm2',
        label: 'Est. VAT area',
        unit: 'cm²',
        text: false,
      },
      {
        key: 'leanHeight2',
        label: 'Lean / height²',
        unit: 'kg/m²',
        text: false,
      },
      {
        key: 'appendicularLeanHeight2',
        label: 'Appendicular lean / height²',
        unit: 'kg/m²',
        text: false,
      },
    ],
    'Scan & instrument': [
      {
        key: 'heightCm',
        label: 'Height',
        unit: 'cm',
        text: false,
      },
      {
        key: 'ageYears',
        label: 'Age at scan',
        unit: 'years',
        text: false,
      },
      {
        key: 'bmi',
        label: 'BMI',
        text: false,
      },
      {
        key: 'manufacturer',
        label: 'Manufacturer',
        text: true,
      },
      {
        key: 'model',
        label: 'Model',
        text: true,
      },
      {
        key: 'serialNumber',
        label: 'Serial number',
        text: true,
      },
      {
        key: 'scanType',
        label: 'Scan type',
        text: true,
      },
      {
        key: 'analysisVersion',
        label: 'Analysis version',
        text: true,
      },
      {
        key: 'providerScanId',
        label: 'Scan ID',
        text: true,
      },
      {
        key: 'boneReference',
        label: 'Bone reference',
        text: true,
      },
      {
        key: 'bodyCompReference',
        label: 'Body-comp reference',
        text: true,
      },
    ],
  },
};

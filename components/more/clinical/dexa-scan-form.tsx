'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { todayInTz } from '@trainingai/shared/date-utils'
import { hapticSuccess } from '@/lib/haptics'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { DateField, GramsField, NumberField, TextField, toNullableNumber, toNullableText } from './clinical-fields'

export interface DexaScanRecord {
  scannedOn: string
  pctFat?: number | null
  [key: string]: unknown
}

/**
 * Typed entry for a DEXA scan (BF-71).
 *
 * **`scannedOn` and `pctFat` are the only two fields anything reads today.**
 * `repo.getBodyFatCalibration` selects exactly those two columns and pairs them against the scale's
 * same-day reading; that pairing is what BF-2's body-fat correction is derived from. Everything
 * below the first section is the owner's clinical record — worth keeping, read by nothing yet — so
 * it is collapsed rather than absent, and the two that matter are the whole first screen.
 *
 * **Per-region bone rows are deliberately not here.** The printout has twelve of them at three
 * fields each, which is thirty-six inputs to transcribe by hand for data nothing reads. The route
 * makes `regions` optional for exactly this reason; BF-41's extract-from-the-document path is what
 * fills them, and this form exists so the owner does not have to wait for it.
 *
 * **No photo path, deliberately.** BF-1's decided rule is crop before upload, because the extraction
 * call sends the document to a model and "redacting after extraction is too late". A typed form has
 * no such exposure, which is the second reason it ships first.
 */
export function DexaScanForm({ onSaved }: { onSaved: (record: DexaScanRecord) => void }) {
  const tz = useUserTimezone()
  const [f, setF] = useState<Record<string, string>>({})
  const [scannedOn, setScannedOn] = useState(() => todayInTz(tz))
  const [saving, setSaving] = useState(false)

  const set = (k: string) => (v: string) => setF(prev => ({ ...prev, [k]: v }))
  const g = (k: string) => f[k] ?? ''

  const pctFat = toNullableNumber(g('pctFat'))
  const pctFatValid = pctFat != null && pctFat >= 0 && pctFat <= 100

  async function save() {
    if (!pctFatValid || saving) return
    setSaving(true)
    try {
      const num = (k: string) => toNullableNumber(g(k))
      const int = (k: string) => {
        const n = toNullableNumber(g(k))
        return n == null ? null : Math.round(n)
      }
      const txt = (k: string) => toNullableText(g(k))

      const record = {
        scannedOn,
        source: 'manual' as const,
        pctFat,
        weightKg: num('weightKg'),
        heightCm: num('heightCm'),
        ageYears: int('ageYears'),
        bmi: num('bmi'),

        fatG: num('fatG'),
        leanG: num('leanG'),
        leanPlusBmcG: num('leanPlusBmcG'),
        totalMassG: num('totalMassG'),
        androidPctFat: num('androidPctFat'),
        gynoidPctFat: num('gynoidPctFat'),
        pctFatYoungNormal: int('pctFatYoungNormal'),
        pctFatAgeMatched: int('pctFatAgeMatched'),

        totalBmd: num('totalBmd'),
        tScore: num('tScore'),
        zScore: num('zScore'),
        totalBmcG: num('totalBmcG'),
        bmdPrecisionCvPct: num('bmdPrecisionCvPct'),

        fatMassHeight2: num('fatMassHeight2'),
        androidGynoidRatio: num('androidGynoidRatio'),
        pctFatTrunkLegs: num('pctFatTrunkLegs'),
        trunkLimbFatMassRatio: num('trunkLimbFatMassRatio'),
        vatMassG: num('vatMassG'),
        vatVolumeCm3: num('vatVolumeCm3'),
        vatAreaCm2: num('vatAreaCm2'),
        leanHeight2: num('leanHeight2'),
        appendicularLeanHeight2: num('appendicularLeanHeight2'),

        manufacturer: txt('manufacturer'),
        model: txt('model'),
        serialNumber: txt('serialNumber'),
        scanType: txt('scanType'),
        analysisVersion: txt('analysisVersion'),
        providerScanId: txt('providerScanId'),
        boneReference: txt('boneReference'),
        bodyCompReference: txt('bodyCompReference'),
      }

      const res = await fetch('/api/dexa-scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      })
      // Same as the RMR form: no outbox domain behind this route, so offline must fail visibly
      // rather than resolve silently into a save that never happened.
      if (!res.ok) throw new Error(String(res.status))
      void hapticSuccess()
      toast.success('DEXA scan saved')
      onSaved(record)
      setF({})
    } catch {
      toast.error('Could not save the scan — check your connection and try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <DateField id="dexa-date" label="Scan date" value={scannedOn} onChange={setScannedOn} />

      <NumberField
        id="dexa-pctfat"
        label="Total body fat"
        unit="%"
        required
        value={g('pctFat')}
        onChange={set('pctFat')}
        placeholder="28.5"
        hint="The one figure the app reads today — it calibrates your scale against this scan."
      />

      <NumberField
        id="dexa-weight"
        label="Weight at scan"
        unit="kg"
        value={g('weightKg')}
        onChange={set('weightKg')}
        placeholder="72.1"
      />

      <CollapsibleSection title="Body composition">
        <div className="flex flex-col gap-3 pt-1">
          <GramsField id="dexa-fat" label="Fat" value={g('fatG')} onChange={set('fatG')} placeholder="20547.5" />
          <GramsField id="dexa-lean" label="Lean" value={g('leanG')} onChange={set('leanG')} placeholder="49532.8" />
          <GramsField
            id="dexa-leanbmc"
            label="Lean + BMC (fat-free mass)"
            value={g('leanPlusBmcG')}
            onChange={set('leanPlusBmcG')}
            placeholder="51460.1"
          />
          <GramsField id="dexa-totalmass" label="Total mass" value={g('totalMassG')} onChange={set('totalMassG')} placeholder="72007.6" />
          <NumberField id="dexa-android" label="Android fat" unit="%" value={g('androidPctFat')} onChange={set('androidPctFat')} />
          <NumberField id="dexa-gynoid" label="Gynoid fat" unit="%" value={g('gynoidPctFat')} onChange={set('gynoidPctFat')} />
          <NumberField
            id="dexa-yn"
            label="Young normal"
            unit="percentile"
            step="1"
            value={g('pctFatYoungNormal')}
            onChange={set('pctFatYoungNormal')}
            hint="A percentile, not a percentage — the report prints both and they look alike."
          />
          <NumberField
            id="dexa-am"
            label="Age matched"
            unit="percentile"
            step="1"
            value={g('pctFatAgeMatched')}
            onChange={set('pctFatAgeMatched')}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Bone">
        <div className="flex flex-col gap-3 pt-1">
          <NumberField id="dexa-bmd" label="Total BMD" unit="g/cm²" value={g('totalBmd')} onChange={set('totalBmd')} placeholder="1.046" />
          <NumberField
            id="dexa-tscore"
            label="T-score"
            value={g('tScore')}
            onChange={set('tScore')}
            placeholder="-1.6"
            hint="Negative is normal here — these are standard deviations."
          />
          <NumberField id="dexa-zscore" label="Z-score" value={g('zScore')} onChange={set('zScore')} placeholder="-1.6" />
          <GramsField id="dexa-bmc" label="Total BMC" value={g('totalBmcG')} onChange={set('totalBmcG')} placeholder="1927.25" />
          <NumberField id="dexa-cv" label="BMD precision (CV)" unit="%" value={g('bmdPrecisionCvPct')} onChange={set('bmdPrecisionCvPct')} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Adipose & lean indices">
        <div className="flex flex-col gap-3 pt-1">
          <NumberField id="dexa-fmh2" label="Fat mass / height²" unit="kg/m²" value={g('fatMassHeight2')} onChange={set('fatMassHeight2')} />
          <NumberField id="dexa-agratio" label="Android / gynoid ratio" value={g('androidGynoidRatio')} onChange={set('androidGynoidRatio')} />
          <NumberField id="dexa-trunklegs" label="% fat trunk / legs" value={g('pctFatTrunkLegs')} onChange={set('pctFatTrunkLegs')} />
          <NumberField id="dexa-trunklimb" label="Trunk / limb fat mass" value={g('trunkLimbFatMassRatio')} onChange={set('trunkLimbFatMassRatio')} />
          <GramsField id="dexa-vatmass" label="Est. VAT mass" value={g('vatMassG')} onChange={set('vatMassG')} placeholder="305" />
          <NumberField id="dexa-vatvol" label="Est. VAT volume" unit="cm³" value={g('vatVolumeCm3')} onChange={set('vatVolumeCm3')} />
          <NumberField id="dexa-vatarea" label="Est. VAT area" unit="cm²" value={g('vatAreaCm2')} onChange={set('vatAreaCm2')} />
          <NumberField id="dexa-leanh2" label="Lean / height²" unit="kg/m²" value={g('leanHeight2')} onChange={set('leanHeight2')} />
          <NumberField
            id="dexa-applean"
            label="Appendicular lean / height²"
            unit="kg/m²"
            value={g('appendicularLeanHeight2')}
            onChange={set('appendicularLeanHeight2')}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Scan & instrument">
        <div className="flex flex-col gap-3 pt-1">
          <NumberField id="dexa-height" label="Height" unit="cm" value={g('heightCm')} onChange={set('heightCm')} />
          <NumberField id="dexa-age" label="Age at scan" unit="years" step="1" value={g('ageYears')} onChange={set('ageYears')} />
          <NumberField id="dexa-bmi" label="BMI" value={g('bmi')} onChange={set('bmi')} />
          <TextField id="dexa-manu" label="Manufacturer" value={g('manufacturer')} onChange={set('manufacturer')} placeholder="Hologic" />
          <TextField id="dexa-model" label="Model" value={g('model')} onChange={set('model')} placeholder="Horizon A" />
          <TextField id="dexa-serial" label="Serial number" value={g('serialNumber')} onChange={set('serialNumber')} />
          <TextField id="dexa-scantype" label="Scan type" value={g('scanType')} onChange={set('scanType')} placeholder="Auto Whole Body Fan Beam" />
          <TextField id="dexa-analysis" label="Analysis version" value={g('analysisVersion')} onChange={set('analysisVersion')} />
          <TextField id="dexa-scanid" label="Scan ID" value={g('providerScanId')} onChange={set('providerScanId')} />
          <TextField id="dexa-boneref" label="Bone reference" value={g('boneReference')} onChange={set('boneReference')} />
          <TextField id="dexa-bodyref" label="Body-comp reference" value={g('bodyCompReference')} onChange={set('bodyCompReference')} />
        </div>
      </CollapsibleSection>

      <Button onClick={save} disabled={!pctFatValid || saving} className="h-12 w-full">
        {saving ? 'Saving…' : 'Save DEXA scan'}
      </Button>
    </div>
  )
}

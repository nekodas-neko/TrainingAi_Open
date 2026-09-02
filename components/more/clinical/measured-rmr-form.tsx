'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { todayInTz } from '@trainingai/shared/date-utils'
import { hapticSuccess } from '@/lib/haptics'
import { invalidateGoalRecommendations } from '@/lib/cache-groups'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { DateField, NumberField, TextField, toNullableNumber, toNullableText } from './clinical-fields'

export interface MeasuredRmrRecord {
  measuredOn: string
  rmrKcal: number
  ffmKgAtTest?: number | null
  weightKgAtTest?: number | null
  method?: string | null
  provider?: string | null
  notes?: string | null
}

/**
 * Typed entry for an indirect-calorimetry RMR test (BF-71).
 *
 * `/api/measured-rmr` and `repo.getLatestMeasuredRmr` shipped with BF-33 and
 * `nutrition-goals/recommend` already reads them; nothing ever called the route, so the table stayed
 * empty and every resting rate the app used stayed predicted. This is the way in.
 *
 * **Two of these fields are load-bearing and the rest are record-keeping.** The recommend route
 * reads exactly `rmrKcal` and `ffmKgAtTest` — the second is what lets a measurement taken at one
 * body composition be re-scaled to today's lean mass instead of being trusted forever, so leaving it
 * blank silently costs the correction its denominator. It is marked on the field rather than
 * enforced, because a report that omits it is still worth storing.
 */
export function MeasuredRmrForm({ onSaved }: { onSaved: (record: MeasuredRmrRecord) => void }) {
  const tz = useUserTimezone()
  const [measuredOn, setMeasuredOn] = useState(() => todayInTz(tz))
  const [rmrKcal, setRmrKcal] = useState('')
  const [ffmKgAtTest, setFfmKgAtTest] = useState('')
  const [weightKgAtTest, setWeightKgAtTest] = useState('')
  const [method, setMethod] = useState('')
  const [provider, setProvider] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const rmr = toNullableNumber(rmrKcal)
  // Mirrors the route's own bound. Checked here so the reason arrives beside the field rather than
  // as a 400 with a Zod issue list the form has nowhere to put.
  const rmrValid = rmr != null && Number.isInteger(rmr) && rmr >= 500 && rmr <= 5000

  async function save() {
    if (!rmrValid || saving) return
    setSaving(true)
    try {
      const record: MeasuredRmrRecord = {
        measuredOn,
        rmrKcal: rmr,
        ffmKgAtTest: toNullableNumber(ffmKgAtTest),
        weightKgAtTest: toNullableNumber(weightKgAtTest),
        method: toNullableText(method),
        provider: toNullableText(provider),
        notes: toNullableText(notes),
      }
      const res = await fetch('/api/measured-rmr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      })
      // There is no outbox domain behind this route, so an offline save cannot be queued. It must
      // therefore fail visibly rather than resolve into nothing — the standing rule is queue a
      // mutation *or* visibly fail, and a swallowed `.catch(() => {})` here would look like a save.
      if (!res.ok) throw new Error(String(res.status))
      // LB-48. Through the named group, never a hand-rolled key list at the call site. This screen
      // does not need the eviction itself — `onSaved(record)` updates it locally — but Profile's
      // goals section reads `measured-rmr` to compute Recommended calories and would otherwise
      // quote the previous resting rate for the rest of the app session.
      void invalidateGoalRecommendations()
      void hapticSuccess()
      toast.success('RMR test saved')
      onSaved(record)
      setRmrKcal('')
      setFfmKgAtTest('')
      setWeightKgAtTest('')
      setNotes('')
    } catch {
      toast.error('Could not save the RMR test — check your connection and try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <DateField id="rmr-date" label="Test date" value={measuredOn} onChange={setMeasuredOn} />

      <NumberField
        id="rmr-kcal"
        label="Measured RMR"
        unit="kcal/day"
        step="1"
        required
        value={rmrKcal}
        onChange={setRmrKcal}
        placeholder="1325"
        hint="The measured resting rate, not the predicted one the report prints beside it."
      />

      <NumberField
        id="rmr-ffm"
        label="Fat-free mass at test"
        unit="kg"
        value={ffmKgAtTest}
        onChange={setFfmKgAtTest}
        placeholder="51.5"
        hint="From the DEXA taken with it (Lean + BMC). Without this the measurement cannot be re-scaled as your lean mass changes, so it ages instead of tracking you."
      />

      {/* BF-99, second half. The owner asked *"why is my base rate under the 1350 RMR value"* and
          part of the answer is that the app never uses the measured number raw — it re-scales it
          onto today's lean mass, so the figure it works from is not the figure he typed. Nothing on
          any screen said so, which makes a measurement he paid for look ignored. The FFM field's
          hint explains why the input is needed; this explains what the app then does with it. */}
      <p className="-mt-1 text-[11px] leading-snug text-muted-foreground">
        The app works from this test re-scaled onto your current lean mass, not the number as
        entered, so the resting rate it uses day to day drifts a little above or below it as your
        body composition changes.
      </p>

      <CollapsibleSection title="Other details">
        <div className="flex flex-col gap-3 pt-1">
          <NumberField
            id="rmr-weight"
            label="Weight at test"
            unit="kg"
            value={weightKgAtTest}
            onChange={setWeightKgAtTest}
            placeholder="72.1"
          />
          <TextField id="rmr-method" label="Method" value={method} onChange={setMethod} placeholder="Indirect calorimetry" />
          <TextField id="rmr-provider" label="Provider" value={provider} onChange={setProvider} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rmr-notes" className="text-[13px] font-medium text-muted-foreground">Notes</label>
            <Textarea id="rmr-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
      </CollapsibleSection>

      <Button onClick={save} disabled={!rmrValid || saving} className="h-12 w-full">
        {saving ? 'Saving…' : 'Save RMR test'}
      </Button>
    </div>
  )
}

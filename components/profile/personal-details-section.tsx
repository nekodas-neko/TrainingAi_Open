'use client'

import { useRouter } from 'next/navigation'
import { ArrowUpRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRovingRadioGroup } from '@/lib/hooks/use-roving-radio-group'

/**
 * Every personal detail, in one place (BF-79).
 *
 * The owner asked to *"combine all the personal information fields into 1 section"*; before this
 * they were split across `EditProfileSheet` (display name) and the Goals accordion's
 * `RequiredInfoSection` (height, birth year, biological sex), which is two places to look for one
 * row of the `users` table.
 *
 * **Weight and body fat are read-only here on purpose.** They are measurements with a history —
 * logged daily, with the profile only ever showing the latest — so making them editable on a
 * profile screen would open a second write path into `body_metrics`, which is the shape the
 * offline-first rules exist to prevent. They link to where they are actually logged instead.
 *
 * **Targets and goals are deliberately NOT here.** A target weight or a step goal is not a personal
 * detail, and moving them in would only relocate the split rather than close it — they stay in
 * Goals. Activity level stays there too: it is an input to the calorie recommendation, not a fact
 * about the person.
 */

export interface PersonalDetailsValues {
  displayName: string
  heightCm: string
  birthYear: string
  sex: string
}

interface PersonalDetailsSectionProps {
  values: PersonalDetailsValues
  onChange: (field: keyof PersonalDetailsValues, value: string) => void
  latestWeightKg: number | null
  latestWeightLabel: string | null
  latestBfPct: number | null
  latestBfLabel: string | null
  saving: boolean
  namePlaceholder?: string
}

export function PersonalDetailsSection({
  values,
  onChange,
  latestWeightKg,
  latestWeightLabel,
  latestBfPct,
  latestBfLabel,
  saving,
  namePlaceholder,
}: PersonalDetailsSectionProps) {
  const sexGroup = useRovingRadioGroup(!!values.sex)
  const router = useRouter()

  return (
    <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden divide-y divide-border">
      <div className="px-4 py-3">
        <Label htmlFor="pd-displayName" className="text-xs text-muted-foreground">Display Name</Label>
        <Input
          id="pd-displayName"
          value={values.displayName}
          onChange={e => onChange('displayName', e.target.value)}
          placeholder={namePlaceholder ?? 'Your name'}
          className="mt-0.5 border-0 bg-transparent p-0 h-auto text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="px-4 py-3 space-y-1.5">
        <p id="pd-sex-label" className="flex items-center gap-2 text-xs leading-none font-medium text-muted-foreground select-none">Biological Sex</p>
        <div className="flex gap-2" {...sexGroup.groupProps} aria-labelledby="pd-sex-label">
          {(['male', 'female', 'other'] as const).map((opt, i) => (
            <button
              key={opt}
              type="button"
              {...sexGroup.getRadioProps(values.sex === opt, i)}
              // `disabled` drops keyboard focus mid-save (Q-355), so the in-flight guard lives in
              // the handler and the control only reports itself unavailable.
              aria-disabled={saving}
              onClick={() => { if (saving) return; onChange('sex', values.sex === opt ? '' : opt) }}
              className={[
                'flex-1 rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition',
                values.sex === opt
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-muted border-transparent text-muted-foreground',
              ].join(' ')}
            >
              {opt === 'male' ? 'Male' : opt === 'female' ? 'Female' : 'Other'}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">Used for BMI and energy balance estimates</p>
      </div>

      <div className="px-4 py-3">
        <Label htmlFor="pd-birthYear" className="text-xs text-muted-foreground">Birth Year</Label>
        <Input
          id="pd-birthYear"
          type="number"
          value={values.birthYear}
          onChange={e => onChange('birthYear', e.target.value)}
          placeholder="1990"
          min={1920}
          max={new Date().getFullYear() - 10}
          disabled={saving}
          className="mt-0.5 border-0 bg-transparent p-0 h-auto text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="px-4 py-3">
        <Label htmlFor="pd-height" className="text-xs text-muted-foreground">Height (cm)</Label>
        <Input
          id="pd-height"
          type="number"
          value={values.heightCm}
          onChange={e => onChange('heightCm', e.target.value)}
          placeholder="175"
          min={50}
          max={300}
          disabled={saving}
          className="mt-0.5 border-0 bg-transparent p-0 h-auto text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
        />
      </div>

      <MeasurementRow
        label="Weight"
        value={latestWeightKg != null ? `${latestWeightKg.toFixed(1)} kg` : null}
        when={latestWeightLabel}
        emptyLabel="No weigh-ins yet"
        action="Log a weigh-in"
        onAction={() => router.push('/health?tab=body')}
      />

      <MeasurementRow
        label="Body Fat %"
        value={latestBfPct != null ? `${latestBfPct.toFixed(1)}%` : null}
        when={latestBfLabel}
        emptyLabel="Not logged"
        action="Log body fat %"
        onAction={() => router.push('/health?tab=body')}
      />
    </div>
  )
}

/** A measured value with the day it was taken, and the way to add another — never an input. */
function MeasurementRow({
  label, value, when, emptyLabel, action, onAction,
}: {
  label: string
  value: string | null
  when: string | null
  emptyLabel: string
  action: string
  onAction: () => void
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 mt-0.5">
        <div className="flex-1 min-w-0">
          {value != null ? (
            <p className="text-sm font-medium truncate">
              {value}
              {when && <span className="text-muted-foreground"> · {when}</span>}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{emptyLabel}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onAction}
          className="flex-none flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition"
        >
          {action}
          <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

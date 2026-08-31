'use client'

import { Input } from '@/components/ui/input'

/**
 * The field primitives the two clinical-entry forms share (BF-71).
 *
 * These forms transcribe a printout the owner is holding, which makes them a different problem from
 * the app's other inputs: every value has a unit printed beside it on the report, and the schema
 * behind them accepts a wide plausibility range on purpose. So the unit belongs *in* the field, and
 * a value that is right in the wrong unit has to be visible before it is saved — see `GramsField`.
 */

/** Empty means "not on my report", which the routes accept as null for every optional field. */
export function toNullableNumber(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function toNullableText(raw: string): string | null {
  const t = raw.trim()
  return t === '' ? null : t
}

export function FieldRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function NumberField({
  id,
  label,
  unit,
  value,
  onChange,
  placeholder,
  hint,
  required,
  step = 'any',
}: {
  id: string
  label: string
  unit?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  required?: boolean
  step?: string
}) {
  return (
    <FieldRow label={unit ? `${label} (${unit})` : label} hint={hint} htmlFor={id}>
      <Input
        id={id}
        // `decimal` rather than `numeric`: several of these are fractional on the printout (BMD
        // 1.046, T-score −1.6) and `numeric` gives a keypad with no decimal point on Android.
        inputMode="decimal"
        type="number"
        step={step}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="h-11"
      />
    </FieldRow>
  )
}

export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
}) {
  return (
    <FieldRow label={label} hint={hint} htmlFor={id}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="h-11"
      />
    </FieldRow>
  )
}

export function DateField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string
}) {
  return (
    <FieldRow label={label} hint={hint} htmlFor={id}>
      <Input id={id} type="date" value={value} onChange={e => onChange(e.target.value)} className="h-11" required />
    </FieldRow>
  )
}

/**
 * A mass field that echoes itself in kilograms.
 *
 * The DEXA schema stores mass in **grams** and bounds it at 0..500,000, which the route's own
 * comment explains is plausibility rather than validation — and it names the exact mistake it cannot
 * catch: "grams entered as kilograms is the likely one". The owner's printout reads `Fat 20,547.5 g`
 * and `Lean 49,532.8 g`; typing 20.5 instead of 20547.5 is inside the bound, saves cleanly, and is
 * wrong by a factor of a thousand in a column BF-2's calibration reads.
 *
 * A tighter bound is not the fix — the route is right that a real range spans children and adults.
 * Showing the value back in the unit the person actually thinks in is: 20,547.5 g reading as
 * "20.5 kg" is obviously fat mass, and 20.5 g reading as "0.02 kg" is obviously not.
 */
export function GramsField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const grams = toNullableNumber(value)
  return (
    <NumberField
      id={id}
      label={label}
      unit="g"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      hint={grams == null ? undefined : `= ${(grams / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`}
    />
  )
}

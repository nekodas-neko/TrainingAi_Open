"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { TTL_LONG } from "@trainingai/shared/cache-ttl";
import { invalidateSupplements } from "@/lib/cache-groups";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { todayInTz } from "@trainingai/shared/date-utils";
import type { SupplementVial } from "@trainingai/shared/types/supplement";
import { concentrationWorking, doseWorking, planDose, DEFAULT_BARREL_UNITS } from "./vial-plan";
import { WeightResponseCard } from "./weight-response-card";
import { VialOpenedNote } from "./vial-opened-note";
import { openedOnBounds, openedOnProblem } from "./vial-date";

/**
 * The vial's key is `supplements-vials:<id>` on purpose, and it depends on prefix semantics:
 * `invalidateCache` deletes `WHERE key LIKE 'prefix%'`, and the existing `invalidateSupplements()`
 * group clears the bare prefix `supplements`. So every supplement write already evicts this without
 * a new group — over-invalidation, which costs one revalidating GET and cannot go stale.
 *
 * Renaming it to anything not starting `supplements` silently removes that, which is why it is
 * written down here rather than left to be inferred from the string.
 */
const vialsKey = (supplementId: string) => `supplements-vials:${supplementId}`

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  supplementId: string
  supplementName: string
  /** Seeds the calculator with the dose the definition carries, when it has a numeric one. */
  defaultDoseMg?: number | null
  /** Reads `body_metrics` from the local store for the weight-response card. */
  userId?: string
}

export function VialSheet({ open, onOpenChange, supplementId, supplementName, defaultDoseMg, userId }: Props) {
  const tz = useUserTimezone()
  const today = todayInTz(tz)
  const [failed, setFailed] = useState(false)
  // Not gated on `open`, and that is deliberate twice over. An empty key would subscribe to every
  // invalidation — `prefix.startsWith('')` is true for all of them — and refetch nothing on each
  // one. And fetching while closed is what makes the sheet paint its saved vial immediately rather
  // than flashing an empty form; at TTL_LONG it costs one GET per app load.
  const loaded = useCachedValue<{ vials: SupplementVial[] }>(
    vialsKey(supplementId),
    `/api/supplements/${supplementId}/vials`,
    TTL_LONG,
    { onError: () => setFailed(true) },
  )
  const current = loaded?.vials?.[0] ?? null

  const [strengthMg, setStrengthMg] = useState('')
  const [waterMl, setWaterMl] = useState('')
  const [unitsPerMl, setUnitsPerMl] = useState(String(DEFAULT_BARREL_UNITS))
  const [doseMg, setDoseMg] = useState('')
  const [openedOn, setOpenedOn] = useState('')
  const [saving, setSaving] = useState(false)

  // Prefilled from the last vial, because reconstitution is stable in practice — one vial lasts
  // weeks, so opening a new one is an explicit act rather than a form to refill at every dose.
  useEffect(() => {
    if (!open) return
    setStrengthMg(current ? String(current.strengthMg) : '')
    setWaterMl(current ? String(current.waterMl) : '')
    setUnitsPerMl(String(current?.syringeUnitsPerMl ?? DEFAULT_BARREL_UNITS))
    setDoseMg(defaultDoseMg == null ? '' : String(defaultDoseMg))
    // BF-136. Today, and NOT `current.openedOn` — the reconstitution numbers above are prefilled
    // from the last vial because they are stable, but a date is not: inheriting the previous vial's
    // would recreate this entry's defect one vial along, silently.
    setOpenedOn(today)
  }, [open, current, defaultDoseMg, today])

  const draft = {
    strengthMg: Number(strengthMg),
    waterMl: Number(waterMl),
    syringeUnitsPerMl: Number(unitsPerMl),
  }
  const concentration = concentrationWorking(draft)
  const dose = Number(doseMg)
  const plan = planDose(dose, draft, draft.syringeUnitsPerMl)
  const working = doseMg.trim() === '' ? null : doseWorking(dose, draft)
  const openedProblem = openedOnProblem(openedOn, today)
  const openedBounds = openedOnBounds(today)

  async function save() {
    if (saving || concentration == null || openedProblem) return
    setSaving(true)
    try {
      const res = await fetch(`/api/supplements/${supplementId}/vials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, openedOn }),
      })
      if (!res.ok) throw new Error(String(res.status))
      await invalidateSupplements()
      toast.success('Vial saved')
      onOpenChange(false)
    } catch {
      toast.error('Could not save the vial')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] flex flex-col">
        <SheetHeader className="flex-none">
          <SheetTitle>{supplementName} — vial &amp; dose</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-5">
          {failed && (
            <p className="text-sm text-destructive">
              Couldn&apos;t load your saved vials. The calculator still works on what you type here.
            </p>
          )}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">This vial</h3>
            <div className="grid grid-cols-2 gap-3">
              <NumField id="vial-strength" label="Peptide" unit="mg" value={strengthMg} onChange={setStrengthMg} />
              <NumField id="vial-water" label="Bac water" unit="mL" value={waterMl} onChange={setWaterMl} />
            </div>
            <NumField id="vial-units" label="Marks on the barrel" unit="per mL" value={unitsPerMl} onChange={setUnitsPerMl} />
            {/* BF-136. This used to be `todayInTz(tz)` with no control, so the response window
                started on whichever day the vial happened to be entered. It anchors every figure on
                the card below and it is the one field that cannot be corrected once wrong. */}
            <div className="space-y-1">
              <Label htmlFor="vial-opened" className="text-xs text-muted-foreground">Opened on</Label>
              <Input
                id="vial-opened"
                type="date"
                value={openedOn}
                min={openedBounds.min}
                max={openedBounds.max}
                onChange={e => setOpenedOn(e.target.value)}
                className="h-11 tabular-nums"
              />
              {openedProblem && <p className="text-xs text-destructive">{openedProblem}</p>}
            </div>
            {/* The division, not only the result: a concentration cannot be checked from its answer. */}
            <p className="text-sm tabular-nums text-muted-foreground">
              {concentration ?? 'Enter the peptide and water to get a concentration.'}
            </p>
          </section>

          <section className="space-y-3 border-t border-border pt-5">
            <h3 className="text-sm font-semibold">Dose</h3>
            <NumField id="dose-mg" label="Dose" unit="mg" value={doseMg} onChange={setDoseMg} />
            {working && (
              <p className="text-sm tabular-nums text-muted-foreground">{working}</p>
            )}
            {plan.units != null && (
              <p className="text-3xl font-bold tabular-nums text-brand">
                {round(plan.units)} <span className="text-base font-semibold text-muted-foreground">units</span>
              </p>
            )}
            {plan.exceedsBarrel && (
              <p className="text-sm font-semibold text-destructive">
                That is more than one {round(draft.syringeUnitsPerMl)}-unit barrel holds.
              </p>
            )}
            {plan.dosesInVial != null && (
              <p className="text-sm text-muted-foreground">
                {plan.dosesInVial} {plan.dosesInVial === 1 ? 'dose' : 'doses'} this size in the vial.
              </p>
            )}
          </section>

          {/* ④. Under the calculator rather than on a screen of its own: the owner asked for the
              four parts in one place, and this is the one that answers "is it working". */}
          {/* BF-136. The window's start, said out loud and correctable in place. Saving a new vial
              is not a way round a wrong date: `listSupplementVials` orders by `openedOn DESC` and
              this sheet reads `vials[0]`, so an earlier-dated vial sorts BELOW the wrong one and
              the card keeps using it. */}
          {current && (
            <VialOpenedNote
              supplementId={supplementId}
              vialId={current.id}
              openedOn={current.openedOn}
              today={today}
            />
          )}

          <WeightResponseCard userId={userId} sinceDate={current?.openedOn ?? null} />
        </div>

        <div className="flex-none px-4 pt-2 border-t">
          <Button
            className="w-full h-12 bg-brand hover:opacity-90 text-brand-foreground font-semibold"
            onClick={save}
            disabled={saving || concentration == null || openedProblem != null}
          >
            {saving ? 'Saving…' : current ? 'Save as a new vial' : 'Save vial'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function NumField({ id, label, unit, value, onChange }: {
  id: string; label: string; unit: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label} ({unit})</Label>
      <Input
        id={id}
        // `decimal` rather than `numeric`: a dose is 0.5 mg and a numeric keypad has no point on it.
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="tabular-nums"
      />
    </div>
  )
}

const round = (n: number) => Number(n.toFixed(1)).toString()

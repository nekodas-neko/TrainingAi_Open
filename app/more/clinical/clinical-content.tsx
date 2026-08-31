'use client'

import { useCallback, useState } from 'react'
import { FlaskConical, Scan, TriangleAlert } from 'lucide-react'
import { MoreSubScreen } from '@/components/more/sub-screen'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { TTL_LONG } from '@trainingai/shared/cache-ttl'
import { MeasuredRmrForm, type MeasuredRmrRecord } from '@/components/more/clinical/measured-rmr-form'
import { DexaScanForm, type DexaScanRecord } from '@/components/more/clinical/dexa-scan-form'

interface RmrRow { measuredOn: string; rmrKcal: number; ffmKgAtTest?: number | null }
interface DexaRow { scannedOn: string; pctFat?: number | null }

/**
 * Where a DEXA scan and an RMR test get typed in (BF-71).
 *
 * Both routes, both repository reads and the recommendation path that consumes them shipped without
 * this screen, so `measured_rmr` and `dexa_scans` were both empty in production and every resting
 * rate the app quoted was predicted. The storage half existed; the way in did not.
 *
 * **The stored values are shown above the forms on purpose.** The question this screen has to answer
 * is "did my 1,325 actually land, and is the app using it" — and a form that saves into silence
 * cannot answer it. It is also what makes BF-42 runnable at all: that entry verifies the Energy
 * Balance card and the goal wizard agree, which needs a measurement to exist first.
 *
 * **No invalidation group, deliberately.** `lib/cache-groups.ts` is where a named group would go,
 * and the standing rule forbids a hand-rolled key list at the write site. Neither key needs one:
 * `cachedFetch` paints the cached value and then always revalidates, neither read passes
 * `freshWithinTtl`, and neither is seed-only — so the entry is a first-paint accelerator, and
 * clearing it would swap a briefly-stale paint for a blank one. The freshly-saved record is held in
 * state instead, which is both instant and true.
 */
export function ClinicalContent() {
  const [savedRmr, setSavedRmr] = useState<MeasuredRmrRecord | null>(null)
  const [savedDexa, setSavedDexa] = useState<DexaScanRecord | null>(null)
  const [rmrError, setRmrError] = useState(false)
  const [dexaError, setDexaError] = useState(false)

  // `cachedFetch` swallows a non-ok response, so without these the two cards cannot tell "nothing
  // stored yet" from "the request failed" — and "nothing stored yet" is exactly the state this
  // screen exists to change, so showing it wrongly is the worst available answer.
  const onRmrError = useCallback(() => setRmrError(true), [])
  const onDexaError = useCallback(() => setDexaError(true), [])

  const rmrData = useCachedValue<{ tests: RmrRow[] }>('measured-rmr', '/api/measured-rmr', TTL_LONG, { onError: onRmrError })
  const dexaData = useCachedValue<{ scans: DexaRow[] }>('dexa-scans', '/api/dexa-scans', TTL_LONG, { onError: onDexaError })

  const latestRmr = savedRmr ?? rmrData?.tests?.[0] ?? null
  const latestDexa = savedDexa ?? dexaData?.scans?.[0] ?? null

  return (
    <MoreSubScreen title="DEXA & RMR">
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Results from a body-composition scan or a metabolic test. A measured resting rate replaces the
        app&rsquo;s predicted one in your calorie target, and a scan calibrates your scale&rsquo;s body-fat reading.
      </p>

      <StoredCard
        icon={<FlaskConical className="h-4 w-4" />}
        title="Resting metabolic rate"
        failed={rmrError && !latestRmr}
        empty={!latestRmr}
        emptyLabel="No test stored — your calorie target is using a predicted rate."
      >
        {latestRmr && (
          <>
            <p className="text-2xl font-bold tabular-nums">{latestRmr.rmrKcal.toLocaleString()} <span className="text-sm font-medium text-muted-foreground">kcal/day</span></p>
            <p className="text-[12px] text-muted-foreground">
              Measured {latestRmr.measuredOn}
              {latestRmr.ffmKgAtTest != null && ` · at ${latestRmr.ffmKgAtTest} kg fat-free mass`}
            </p>
            {latestRmr.ffmKgAtTest == null && (
              <p className="text-[12px] text-amber-600 dark:text-amber-400">
                No fat-free mass recorded, so this cannot be re-scaled as your lean mass changes.
              </p>
            )}
          </>
        )}
      </StoredCard>

      <StoredCard
        icon={<Scan className="h-4 w-4" />}
        title="Latest DEXA scan"
        failed={dexaError && !latestDexa}
        empty={!latestDexa}
        emptyLabel="No scan stored — nothing is calibrating your scale&rsquo;s body-fat reading."
      >
        {latestDexa && (
          <>
            <p className="text-2xl font-bold tabular-nums">
              {latestDexa.pctFat != null ? `${latestDexa.pctFat}%` : '—'} <span className="text-sm font-medium text-muted-foreground">body fat</span>
            </p>
            <p className="text-[12px] text-muted-foreground">Scanned {latestDexa.scannedOn}</p>
          </>
        )}
      </StoredCard>

      <CollapsibleSection title="Add an RMR test" icon={<FlaskConical className="h-4 w-4" />} defaultOpen={!latestRmr}>
        <div className="pt-2">
          <MeasuredRmrForm onSaved={setSavedRmr} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Add a DEXA scan" icon={<Scan className="h-4 w-4" />} defaultOpen={!latestDexa}>
        <div className="pt-2">
          <DexaScanForm onSaved={setSavedDexa} />
        </div>
      </CollapsibleSection>
    </MoreSubScreen>
  )
}

function StoredCard({
  icon,
  title,
  failed,
  empty,
  emptyLabel,
  children,
}: {
  icon: React.ReactNode
  title: string
  failed: boolean
  empty: boolean
  emptyLabel: string
  children?: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 pb-1.5 text-[13px] font-semibold text-muted-foreground">
        {icon}
        {title}
      </div>
      {failed ? (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <TriangleAlert className="h-3.5 w-3.5 flex-none" />
          Could not load — pull down to retry.
        </p>
      ) : empty ? (
        <p className="text-[13px] text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-0.5">{children}</div>
      )}
    </section>
  )
}

import Link from 'next/link'
import { FlameIcon, ChevronRightIcon } from 'lucide-react'

/**
 * Shown in place of the energy-budget card when it can't be computed — the budget needs weight,
 * height, age and sex, and one of those isn't set in the profile.
 *
 * **⚠ LB-176: this is harder to reach than the line above suggests, and it used to render for the
 * wrong reason.** `health-sections.tsx` chose it whenever `energyBalance` was null — which is true
 * while loading, on a FAILED read, and for an empty account alike. So a request that did not land told
 * the owner to re-enter details he set months ago, and a cold load flashed the same instruction before
 * the payload arrived. That branch now splits by cause and this component only renders with a payload
 * in hand.
 *
 * **And the case it documents routes elsewhere:** the service always returns `missingProfileFields`,
 * and a non-empty one goes to `CalorieBalanceBar`, which names the fields actually missing instead of
 * guessing these three. That leaves this component's remaining branch hard to reach — but
 * "unreachable" was not proven, so it was kept rather than deleted on an assumption. If you are here
 * to change the copy, check first whether anything still renders it.
 */
export function EnergyBudgetPrompt() {
  return (
    <Link
      href="/more"
      className="flex items-center gap-3 rounded-2xl border border-border bg-muted/30 p-4 transition hover:bg-muted/50"
    >
      <FlameIcon className="h-6 w-6 flex-none" style={{ color: 'var(--accent-amber)' }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Set up your energy budget</p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Add your height, age and sex in Profile to see how much you can eat and how much you&apos;ve burned today.
        </p>
      </div>
      <ChevronRightIcon className="h-5 w-5 flex-none text-muted-foreground" />
    </Link>
  )
}

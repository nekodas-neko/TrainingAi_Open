import Link from 'next/link'
import { FlameIcon, ChevronRightIcon } from 'lucide-react'

/**
 * Shown in place of the energy-budget card when it can't be computed — the budget needs weight,
 * height, age and sex, and one of those isn't set in the profile. Prompts the user to complete it
 * instead of the card silently vanishing.
 */
export function EnergyBudgetPrompt() {
  return (
    <Link
      href="/profile"
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

import type { CatSummary, Ladder } from '@trainingai/shared/collection/ladder'
import { CatSprite } from '@/components/home/cat-sprite'
import type { FaucetKey } from '@/components/home/collection-summary'

const SHOWN = 20
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** The day string is already the user's calendar day, so it is read, never re-parsed through a Date. */
const shortDay = (day: string) => { const [, m, d] = day.split('-').map(Number); return `${d} ${MONTHS[m - 1]}` }

function madeFrom(names: string[]): string {
  if (names.length === 0) return ''
  const head = names.slice(0, 3).join(', ')
  return names.length > 3 ? `from ${head} +${names.length - 3}` : `from ${head}`
}

/**
 * Every cat on a ladder by name: its tier, the day it arrived, and the cats it was made from. The
 * names are the replay's own, so a cat here is the same cat wandering in the Home pen.
 */
export function CatRoster({ faucet, ladder, cats }: { faucet: FaucetKey; ladder: Ladder; cats: CatSummary[] | undefined }) {
  if (!cats?.length) return null
  return (
    <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
      {cats.slice(0, SHOWN).map(cat => (
        <li key={cat.id} className="flex items-center gap-2">
          <CatSprite faucet={faucet} tier={cat.tier} size={28} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">
              {cat.name}{' '}
              <span className="font-normal text-muted-foreground first-letter:uppercase">· {ladder.tiers[cat.tier]?.name}</span>
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {shortDay(cat.born)}{cat.from.length > 0 && ` · ${madeFrom(cat.from)}`}
            </p>
          </div>
        </li>
      ))}
      {cats.length > SHOWN && <li className="text-[10px] text-muted-foreground">+{cats.length - SHOWN} more</li>}
    </ul>
  )
}

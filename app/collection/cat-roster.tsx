import type { CatSummary, V2Ladder } from '@trainingai/shared/collection/ladder'
import { CatSprite } from '@/components/home/cat-sprite'
import { ROSTER_SHOWN, rosterDetail, type FaucetKey } from '@/components/home/collection-summary'

/**
 * Every cat on a ladder by name: its tier, the day it arrived, and the cats it was made from. The
 * names are the replay's own, so a cat here is the same cat wandering in the Home pen.
 */
export function CatRoster({ faucet, ladder, cats }: { faucet: FaucetKey; ladder: V2Ladder; cats: CatSummary[] | undefined }) {
  if (!cats?.length) return null
  return (
    <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
      {cats.slice(0, ROSTER_SHOWN).map(cat => (
        <li key={cat.id} className="flex items-center gap-2">
          <CatSprite faucet={faucet} tier={cat.tier} size={28} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">
              {cat.name}{' '}
              <span className="font-normal text-muted-foreground first-letter:uppercase">· {ladder.tiers[cat.tier]?.name}</span>
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {rosterDetail(cat)}
            </p>
          </div>
        </li>
      ))}
      {cats.length > ROSTER_SHOWN && <li className="text-[10px] text-muted-foreground">+{cats.length - ROSTER_SHOWN} more</li>}
    </ul>
  )
}

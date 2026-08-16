"use client"

import { ChevronLeft } from "lucide-react"
import { ScreenHeader } from "@/components/shell/screen-header"
import { useTransitionRouter } from "@/lib/view-transition"

/** The shell every More sub-route uses: navless takeover, centred title, back chevron.
 *
 *  Extracted at the second copy. The scroll container is `pb-safe-action-lg`, not `pb-safe` —
 *  these screens render no bottom nav and their content ends in tappable controls, and the raw
 *  bottom inset reports near-zero on Android gesture nav, so only a floored utility clears it. */
export function MoreSubScreen({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useTransitionRouter()
  return (
    <div className="flex flex-col bg-page" style={{ height: "100dvh" }}>
      <ScreenHeader bordered={false}>
        <div className="flex w-full items-center gap-1">
          {/* Outside the tab shell, so without this the row that opened the screen is a one-way
              trip. Same shape as the day-detail screen. */}
          <button
            type="button"
            aria-label="Back"
            onClick={() => router.back()}
            className="flex h-12 w-12 flex-none items-center justify-center rounded-xl text-muted-foreground transition active:scale-95"
          >
            <ChevronLeft className="h-[22px] w-[22px]" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-extrabold tracking-tight">{title}</h1>
          <span className="h-12 w-12 flex-none" aria-hidden />
        </div>
      </ScreenHeader>

      <div className="flex-1 space-y-4 overflow-y-auto scrollbar-hide px-4 pt-2 pb-safe-action-lg">
        {children}
      </div>
    </div>
  )
}

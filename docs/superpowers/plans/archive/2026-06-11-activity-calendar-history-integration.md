> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Activity Calendar & History Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user see past activities (including GPS routes) from the
History calendar's day overlay and from the existing activity card on the
Health page, via a shared read-only detail view with a route map.

**Architecture:** A new `activity-detail-sheet.tsx` component renders an
`ActivityLog`'s stats, splits, and (if present) its decoded route on
`activity-route-map.tsx`. `app/history/history-content.tsx`'s day overlay
gets a new "Activity" section using the `activityLogs` data `/api/day-log`
already returns. `components/health/activity-history-card.tsx` is wired to
open the same detail sheet on tap.

**Tech Stack:** Next.js 15 App Router, React 19, `react-leaflet` (via
`activity-route-map.tsx` from Plan 2), existing `cachedFetch`/`/api/day-log`/
`/api/activity-types` endpoints.

---

This is **Plan 3 of 3** for `docs/superpowers/specs/2026-06-11-live-activity-tracking-design.md`
(Sections 5-6). **Depends on Plan 2** (`docs/superpowers/plans/2026-06-11-activity-gps-tracking-and-live-ui.md`)
for `components/activity/activity-route-map.tsx` and the `RoutePoint`/decode
helpers from Plan 1's `lib/activity/route-encoding.ts`.

## File Structure

| File | Status | Responsibility |
|------|--------|-----------------|
| `components/activity/activity-detail-sheet.tsx` | Create | Read-only activity detail view (stats + map + notes) |
| `app/history/history-content.tsx` | Modify | Add "Activity" section to day overlay, open detail sheet |
| `components/health/activity-history-card.tsx` | Modify | Open detail sheet on row tap |

---

## Task 1: `components/activity/activity-detail-sheet.tsx`

**Files:**
- Create: `components/activity/activity-detail-sheet.tsx`

- [ ] **Step 1: Implement the detail sheet**

```tsx
'use client'

import dynamic from 'next/dynamic'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { getActivityIcon } from '@/lib/constants/activity-icons'
import { decodeRoute } from '@/lib/activity/route-encoding'
import type { ActivityLog } from '@/lib/types'

const ActivityRouteMap = dynamic(
  () => import('./activity-route-map').then(m => m.ActivityRouteMap),
  { ssr: false },
)

function formatPace(secPerKm: number): string {
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')} /km`
}

interface ActivityDetailSheetProps {
  log: ActivityLog | null
  icon: string
  onOpenChange: (open: boolean) => void
}

export function ActivityDetailSheet({ log, icon, onOpenChange }: ActivityDetailSheetProps) {
  const Icon = getActivityIcon(icon)
  const routePoints = log?.routePolyline ? decodeRoute(log.routePolyline) : []

  return (
    <Sheet open={log !== null} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="mb-2">
          <SheetTitle className="flex items-center gap-2 text-left">
            <Icon size={20} weight="fill" style={{ color: 'var(--color-brand)' }} />
            {log?.title}
          </SheetTitle>
        </SheetHeader>

        {log && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {log.date}
              {log.startTime ? ` · ${log.startTime}` : ''}
              {log.endTime ? ` – ${log.endTime}` : ''}
            </p>

            <div className="grid grid-cols-3 gap-2 text-center">
              {log.durationMin != null && (
                <div className="rounded-xl bg-muted px-2 py-3">
                  <p className="text-lg font-bold tabular-nums">{log.durationMin}</p>
                  <p className="text-[10px] text-muted-foreground">min</p>
                </div>
              )}
              {log.distanceKm != null && (
                <div className="rounded-xl bg-muted px-2 py-3">
                  <p className="text-lg font-bold tabular-nums">{log.distanceKm}</p>
                  <p className="text-[10px] text-muted-foreground">km</p>
                </div>
              )}
              {log.avgPaceSecPerKm != null && (
                <div className="rounded-xl bg-muted px-2 py-3">
                  <p className="text-lg font-bold tabular-nums">{formatPace(log.avgPaceSecPerKm)}</p>
                  <p className="text-[10px] text-muted-foreground">avg pace</p>
                </div>
              )}
            </div>

            {(log.avgHr != null || log.maxHr != null || log.caloriesBurned != null) && (
              <div className="grid grid-cols-3 gap-2 text-center">
                {log.avgHr != null && (
                  <div className="rounded-xl bg-muted px-2 py-3">
                    <p className="text-lg font-bold tabular-nums">{log.avgHr}</p>
                    <p className="text-[10px] text-muted-foreground">avg HR</p>
                  </div>
                )}
                {log.maxHr != null && (
                  <div className="rounded-xl bg-muted px-2 py-3">
                    <p className="text-lg font-bold tabular-nums">{log.maxHr}</p>
                    <p className="text-[10px] text-muted-foreground">max HR</p>
                  </div>
                )}
                {log.caloriesBurned != null && (
                  <div className="rounded-xl bg-muted px-2 py-3">
                    <p className="text-lg font-bold tabular-nums">{Math.round(log.caloriesBurned)}</p>
                    <p className="text-[10px] text-muted-foreground">kcal</p>
                  </div>
                )}
              </div>
            )}

            {(log.elevationGainM != null || log.elevationLossM != null) && (
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-muted px-2 py-3">
                  <p className="text-lg font-bold tabular-nums">{log.elevationGainM ?? 0} m</p>
                  <p className="text-[10px] text-muted-foreground">elevation gain</p>
                </div>
                <div className="rounded-xl bg-muted px-2 py-3">
                  <p className="text-lg font-bold tabular-nums">{log.elevationLossM ?? 0} m</p>
                  <p className="text-[10px] text-muted-foreground">elevation loss</p>
                </div>
              </div>
            )}

            {routePoints.length > 1 && (
              <ActivityRouteMap points={routePoints} className="h-56 w-full" />
            )}

            {log.splits && log.splits.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Splits</p>
                {log.splits.map(s => (
                  <div key={s.km} className="flex justify-between rounded-lg bg-muted px-3 py-1.5 text-sm">
                    <span>Km {s.km}</span>
                    <span className="tabular-nums">{formatPace(s.paceSec)}</span>
                  </div>
                ))}
              </div>
            )}

            {log.notes && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
                <p className="text-sm text-muted-foreground">{log.notes}</p>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/activity/activity-detail-sheet.tsx
git commit -m "Add read-only activity detail sheet with route map and stats"
```

---

## Task 2: Day overlay "Activity" section in History

**Files:**
- Modify: `app/history/history-content.tsx`

- [ ] **Step 1: Fetch activity types and track the selected activity**

In `app/history/history-content.tsx`, add imports near the top (alongside
the existing imports):

```ts
import { ActivityDetailSheet } from "@/components/activity/activity-detail-sheet";
import { getActivityIcon } from "@/lib/constants/activity-icons";
import type { ActivityLog, ActivityType } from "@/lib/types";
```

Add new state alongside the existing `useState` declarations (after
`mutating`):

```ts
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<ActivityLog | null>(null);
```

In the existing `useEffect` that runs on mount (the one fetching
`workout-data:meta` and `calendar-data`), add a fetch for activity types:

```ts
    cachedFetch<{ activityTypes: ActivityType[] }>(
      'activity-types', '/api/activity-types', TTL_LONG,
      d => setActivityTypes(d?.activityTypes ?? []),
    ).catch(() => {});
```

- [ ] **Step 2: Render an "Activity" section in the day overlay**

In the day overlay's content block (the `{!dayOverlay?.loading &&
dayOverlay?.data && (() => { ... })()}` IIFE), `dayOverlay.data.activityLogs`
is already available (from `DayLogResult`). Add a new section after the
"Exercise" section's `sessionNames.map(...)` block and before the
`bodyMeta` "Nutrition" section:

```tsx
                  {dayOverlay.data.activityLogs.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">Activity</p>
                      {dayOverlay.data.activityLogs.map(log => {
                        const type = activityTypes.find(t => t.id === log.activityType);
                        const Icon = getActivityIcon(type?.icon ?? 'DotsThreeCircle');
                        return (
                          <button
                            key={log.id}
                            type="button"
                            onClick={() => setSelectedActivity(log)}
                            className="flex w-full items-center gap-3 rounded-xl bg-muted px-4 py-3 text-left"
                          >
                            <Icon size={20} className="flex-none text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate">{log.title}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {log.startTime ? `${log.startTime} · ` : ''}
                                {log.durationMin != null ? `${log.durationMin} min` : ''}
                              </p>
                            </div>
                            {log.distanceKm != null && (
                              <span className="text-xs text-muted-foreground flex-none">{log.distanceKm} km</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
```

- [ ] **Step 3: Render the detail sheet**

After the existing `</Sheet>` that closes the day overlay sheet (and before
the "Edit dialog" `<Dialog>`), add:

```tsx
      <ActivityDetailSheet
        log={selectedActivity}
        icon={activityTypes.find(t => t.id === selectedActivity?.activityType)?.icon ?? 'DotsThreeCircle'}
        onOpenChange={open => { if (!open) setSelectedActivity(null); }}
      />
```

- [ ] **Step 4: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/history/history-content.tsx
git commit -m "Show activity logs with route detail in the history day overlay"
```

---

## Task 3: Wire `ActivityHistoryCard` to the detail sheet

**Files:**
- Modify: `components/health/activity-history-card.tsx`

- [ ] **Step 1: Replace the inline expand with the shared detail sheet**

In `components/health/activity-history-card.tsx`:

1. Add the import:
```ts
import { ActivityDetailSheet } from '@/components/activity/activity-detail-sheet'
```

2. Replace the `expandedId` state with a selected-log state:
```ts
  const [selected, setSelected] = useState<ActivityLog | null>(null)
```
(remove the old `const [expandedId, setExpandedId] = useState<string | null>(null)`)

3. Replace the row `<button onClick={...}>` handler:
```tsx
                onClick={() => setSelected(log)}
```
(remove the `isExpanded`/`hasDetails` logic, the `ChevronDownIcon`/`ChevronUpIcon` import and usage, and the expanded detail `<div>` block — the detail sheet now shows avg/max HR and notes).

4. After the closing `</div>` of the component's root `<div>`, render the
sheet:
```tsx
      <ActivityDetailSheet
        log={selected}
        icon={iconByType.get(selected?.activityType ?? '') ?? 'DotsThreeCircle'}
        onOpenChange={open => { if (!open) setSelected(null); }}
      />
```

5. Add the `ActivityLog` type import if not already present:
```ts
import type { ActivityLog, ActivityType } from '@/lib/types'
```

- [ ] **Step 2: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`

Expected: no errors. `ChevronDownIcon`/`ChevronUpIcon` imports from
`lucide-react` should be removed if no longer used elsewhere in the file.

- [ ] **Step 3: Commit**

```bash
git add components/health/activity-history-card.tsx
git commit -m "Open shared activity detail sheet from the activity history card"
```

---

## Task 4: Manual end-to-end check

**Files:** none (verification only)

- [ ] **Step 1: Seed a sample activity log with route data**

Run:
```bash
PGPASSWORD=postgres psql -h /tmp -p 5433 -U postgres -d trainingai_dev -c "
INSERT INTO activity_logs (
  user_id, date, activity_type, title, start_time, end_time,
  duration_min, distance_km, route_polyline, splits, avg_pace_sec_per_km,
  elevation_gain_m, elevation_loss_m
) VALUES (
  (SELECT id FROM users WHERE email = 'test@local.dev'),
  CURRENT_DATE, 'run', 'Morning Run', '06:00', '06:30',
  30, 5.0, '_p~iF~ps|U_ulLnnqC', '[{\"km\":1,\"paceSec\":300},{\"km\":2,\"paceSec\":295}]', 300,
  25, 18
);"
```

Expected: `INSERT 0 1`.

- [ ] **Step 2: Start the dev server and check the History calendar**

Run: `pnpm dev`

1. Sign in as `test@local.dev` / `testpass123`.
2. Go to the History tab. Confirm today's date on the calendar shows an
   activity indicator.
3. Tap today's date. Confirm the day overlay shows an "Activity" section
   with "Morning Run", "06:00 · 30 min", and "5 km".
4. Tap the "Morning Run" row. Confirm the detail sheet opens showing the
   route map (a short line near Lake Tahoe, CA — the sample polyline's
   coordinates), duration/distance/avg pace stats, elevation gain/loss, and
   the two splits.

- [ ] **Step 3: Check the Health page activity card**

1. Go to the Health tab. Confirm the "Activities" card shows "Morning Run".
2. Tap the row. Confirm the same detail sheet opens with the same content.

- [ ] **Step 4: Clean up the seeded row**

```bash
PGPASSWORD=postgres psql -h /tmp -p 5433 -U postgres -d trainingai_dev \
  -c "DELETE FROM activity_logs WHERE title = 'Morning Run';"
```

No commit for this task — verification only.

---

## Self-Review Notes

- **Spec coverage:** Section 5 (calendar/history integration) — Tasks 1-3.
  Section 6 ("out of scope" carve-outs from the original spec — pace charts,
  cadence) require no implementation here, consistent with the spec's Out of
  Scope list.
- **Type consistency:** `ActivityDetailSheet`'s `log: ActivityLog | null`
  and `icon: string` props are used identically in Task 2
  (`history-content.tsx`) and Task 3 (`activity-history-card.tsx`). The
  `ActivityLog` fields referenced (`routePolyline`, `splits`,
  `avgPaceSecPerKm`, `elevationGainM`, `elevationLossM`, `avgHr`, `maxHr`,
  `caloriesBurned`, `notes`) all come from Plan 1's extended `ActivityLog`
  type (`lib/types/body.ts`). `decodeRoute` and `ActivityRouteMap` are
  reused unchanged from Plans 1 and 2.

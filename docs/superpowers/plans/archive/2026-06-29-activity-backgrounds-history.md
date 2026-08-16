# Activity Section Backgrounds + Historical Trends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each health detail page (Sleep, Readiness, Activity, Heart Rate) a themed gradient hero background and add 14-day trend sparklines + delta chips so users can see historical context, not just today's snapshot.

**Architecture:** Each page gains a tall gradient hero section (CSS only, no image assets) with the score overlaid, plus a back button floating over the top. A new `/api/health/trends` endpoint returns 14 days of scores from existing `oura_daily` + `body_metrics` tables. A shared `TrendSparkline` component renders the line chart using react-chartjs-2 (already installed). A shared `DetailHero` component handles the gradient + back button overlay consistently across all four pages.

**Tech Stack:** Next.js 15, react-chartjs-2 + chart.js (already installed), Tailwind CSS v4, Lucide icons. No new packages required.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `app/api/health/trends/route.ts` | **Create** | Return 14-day daily trend arrays for readiness/sleep/activity/hrv/rhr |
| `components/health/detail-hero.tsx` | **Create** | Themed gradient hero container + floating back button + score slot |
| `components/health/trend-sparkline.tsx` | **Create** | 14-day line chart (react-chartjs-2) + delta chip |
| `app/health/sleep/page.tsx` | **Modify** | Add DetailHero + TrendSparkline |
| `app/health/readiness/page.tsx` | **Modify** | Add DetailHero + TrendSparkline |
| `app/health/activity/page.tsx` | **Modify** | Add DetailHero + TrendSparkline |
| `app/health/heart-rate/page.tsx` | **Modify** | Add DetailHero + TrendSparkline |

---

## Task 1: API endpoint — `/api/health/trends`

**Files:**
- Create: `app/api/health/trends/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
// app/api/health/trends/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay } from '@/lib/date-utils'
import { rateLimit } from '@/lib/rate-limit'

export interface HealthTrendDay {
  date: string            // YYYY-MM-DD
  readinessScore: number | null
  sleepScore: number | null
  activityScore: number | null
  hrvMs: number | null
  rhrBpm: number | null
}

export interface HealthTrendsResponse {
  trends: HealthTrendDay[]  // oldest → newest, up to 14 days
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:health-trends`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepository()
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const todayIso = todayInTz(tz)
  const todayMid = todayMidnightUtc(tz)
  const from14dIso = toAestDay(new Date(todayMid.getTime() - 14 * 86_400_000), tz)

  const [ouraRows, bodyRows] = await Promise.all([
    repo.getOuraDaily(userId, from14dIso, todayIso),
    repo.listBodyMetrics(userId, from14dIso, todayIso),
  ])

  // Build date-keyed maps
  const ouraByDate = new Map(ouraRows.map(r => [r.date, r]))
  const bodyByDate = new Map(bodyRows.map(r => [r.date, r]))

  // Generate last 14 days (oldest first)
  const trends: HealthTrendDay[] = []
  for (let i = 13; i >= 0; i--) {
    const d = toAestDay(new Date(todayMid.getTime() - i * 86_400_000), tz)
    const oura = ouraByDate.get(d)
    const body = bodyByDate.get(d)
    trends.push({
      date: d,
      readinessScore: oura?.readinessScore ?? null,
      sleepScore: oura?.sleepScore ?? null,
      activityScore: oura?.activityScore ?? null,
      hrvMs: body?.hrvMs ?? null,
      rhrBpm: body?.restingHeartRate ?? null,
    })
  }

  return NextResponse.json({ trends } satisfies HealthTrendsResponse)
}
```

- [ ] **Step 2: Verify `toAestDay` accepts a Date + tz string**

```bash
grep -n "export function toAestDay" /home/user/TrainingAI/lib/date-utils.ts
```

Expected: a line like `export function toAestDay(date: Date, tz?: string): string`

If the second param is optional, `toAestDay(date, tz)` is safe as-is. If the function doesn't exist under that name, check `lib/date-utils.ts` for the right helper and update `toAestDay` calls in the route to match.

- [ ] **Step 3: Verify `listBodyMetrics` returns `restingHeartRate`**

```bash
grep -n "restingHeartRate\|resting_heart_rate" /home/user/TrainingAI/lib/data/repository.ts | head -5
```

Expected: `restingHeartRate?: number | null` in the `BodyMetrics` interface. If the field name differs, adjust `body?.restingHeartRate` in the route.

- [ ] **Step 4: Smoke-test the endpoint (dev server must be running)**

```
GET http://localhost:3000/api/health/trends
```

Expected: `{ trends: [ { date: "...", readinessScore: N|null, ... }, ... ] }` — 14 entries.

- [ ] **Step 5: Commit**

```bash
git add app/api/health/trends/route.ts
git commit -m "Add /api/health/trends endpoint — 14-day oura + body metrics rollup"
```

---

## Task 2: `DetailHero` shared component

**Files:**
- Create: `components/health/detail-hero.tsx`

The hero occupies the top ~260px of each page. It contains:
1. A full-bleed themed gradient background
2. A floating back-button in the top-left (with safe-area awareness)
3. A slot for the page title (text label)
4. A `children` slot where the score arc sits, centred inside the hero

The bottom of the hero fades to `transparent` so it bleeds naturally into the `bg-background` content below.

- [ ] **Step 1: Create the component**

```typescript
// components/health/detail-hero.tsx
"use client";

import { useRouter } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";

export type HeroTheme = "sleep" | "readiness" | "activity" | "heart-rate";

const GRADIENTS: Record<HeroTheme, string> = {
  sleep: "linear-gradient(180deg, #060620 0%, #0d0b3a 25%, #1a0f4e 50%, #0f1533 75%, transparent 100%)",
  readiness: "linear-gradient(180deg, #2e1065 0%, #7c2d12 30%, #c2410c 55%, #d97706 80%, transparent 100%)",
  activity: "linear-gradient(180deg, #022c22 0%, #064e3b 30%, #065f46 60%, #047857 80%, transparent 100%)",
  "heart-rate": "linear-gradient(180deg, #2d0a0a 0%, #7f1d1d 30%, #991b1b 60%, #b91c1c 80%, transparent 100%)",
};

// Decorative SVG overlays — subtle, CSS-only
function SleepDecoration() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-30" xmlns="http://www.w3.org/2000/svg">
      {/* Moon */}
      <circle cx="82%" cy="22%" r="22" fill="none" stroke="#c4b5fd" strokeWidth="1.5" />
      <circle cx="88%" cy="18%" r="18" fill="#060620" />
      {/* Stars */}
      {[
        [15, 12], [28, 8], [42, 18], [55, 6], [68, 20], [20, 30], [35, 38],
        [60, 32], [72, 10], [10, 45], [50, 42], [80, 35], [90, 48],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={`${cx}%`} cy={`${cy}%`} r="1.2" fill="white" opacity={0.6 + (i % 3) * 0.15} />
      ))}
    </svg>
  );
}

function ReadinessDecoration() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20" xmlns="http://www.w3.org/2000/svg">
      {/* Horizon rays */}
      {[-40, -25, -10, 5, 20, 35, 50].map((angle, i) => (
        <line key={i}
          x1="50%" y1="85%"
          x2={`${50 + Math.sin((angle * Math.PI) / 180) * 120}%`} y2="-10%"
          stroke="#fbbf24" strokeWidth="1" opacity="0.4"
        />
      ))}
      {/* Sun arc */}
      <ellipse cx="50%" cy="88%" rx="60" ry="40" fill="none" stroke="#f97316" strokeWidth="1.5" />
    </svg>
  );
}

function ActivityDecoration() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-15" xmlns="http://www.w3.org/2000/svg">
      {/* Rolling hills */}
      <path d="M0 80% Q25% 60% 50% 72% Q75% 84% 100% 65% L100% 100% L0 100% Z" fill="#10b981" opacity="0.3" />
      <path d="M0 90% Q30% 75% 60% 85% Q80% 92% 100% 78% L100% 100% L0 100% Z" fill="#059669" opacity="0.4" />
    </svg>
  );
}

function HeartRateDecoration() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
      {/* ECG line */}
      <polyline
        points="0,55% 15%,55% 20%,55% 25%,30% 30%,75% 35%,20% 40%,65% 45%,55% 60%,55% 100%,55%"
        fill="none" stroke="#ef4444" strokeWidth="1.5" opacity="0.25"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

const DECORATIONS: Record<HeroTheme, React.FC> = {
  sleep: SleepDecoration,
  readiness: ReadinessDecoration,
  activity: ActivityDecoration,
  "heart-rate": HeartRateDecoration,
};

interface DetailHeroProps {
  theme: HeroTheme;
  title: string;
  children: React.ReactNode;
}

export function DetailHero({ theme, title, children }: DetailHeroProps) {
  const router = useRouter();
  const Decoration = DECORATIONS[theme];

  return (
    <div className="relative w-full" style={{ minHeight: 260 }}>
      {/* Gradient background */}
      <div
        className="absolute inset-0"
        style={{ background: GRADIENTS[theme] }}
      />
      {/* Theme decoration */}
      <Decoration />

      {/* Back button — floats over gradient */}
      <div className="absolute top-0 left-0 right-0 flex items-center px-2 pt-safe-or-4 pb-2 z-10">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-xl hover:bg-white/10 transition-colors"
        >
          <ChevronLeftIcon className="h-5 w-5 text-white/90" />
        </button>
        <h1 className="text-sm font-semibold text-white/80 ml-1">{title}</h1>
      </div>

      {/* Score slot — centred in the lower portion of the hero */}
      <div className="relative flex flex-col items-center justify-end pb-8 pt-16" style={{ minHeight: 260 }}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/health/detail-hero.tsx
git commit -m "Add DetailHero component — themed gradient backgrounds for health detail pages"
```

---

## Task 3: `TrendSparkline` shared component

**Files:**
- Create: `components/health/trend-sparkline.tsx`

Shows a 14-day line chart with:
- A colour-themed line
- X-axis: day-of-week labels (Mon, Tue…)
- A delta chip: "▲ +5 vs last week" in green, or "▼ −3" in red, or "— same" in muted

- [ ] **Step 1: Create the component**

```typescript
// components/health/trend-sparkline.tsx
"use client";

import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement,
  LineElement, Tooltip, Filler,
} from "chart.js";
import type { HealthTrendDay } from "@/app/api/health/trends/route";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

type Field = "readinessScore" | "sleepScore" | "activityScore" | "hrvMs" | "rhrBpm";

interface TrendSparklineProps {
  trends: HealthTrendDay[];
  field: Field;
  label: string;
  color: string;     // CSS colour string, e.g. "#22c55e"
  unit?: string;     // e.g. "ms" for HRV, "bpm" for RHR — shown in tooltip
}

function deltaChip(trends: HealthTrendDay[], field: Field) {
  const values = trends.map(t => t[field] as number | null);
  const today = values[values.length - 1];
  const weekAgo = values.slice(0, 7).filter((v): v is number => v != null);
  if (today == null || weekAgo.length === 0) return null;
  const weekAvg = weekAgo.reduce((s, v) => s + v, 0) / weekAgo.length;
  const diff = Math.round(today - weekAvg);
  if (diff === 0) return { text: "— same as last week", color: "text-muted-foreground" };
  const sign = diff > 0 ? "▲" : "▼";
  const colorClass = diff > 0 ? "text-green-400" : "text-red-400";
  return { text: `${sign} ${Math.abs(diff)} vs last week`, color: colorClass };
}

export function TrendSparkline({ trends, field, label, color, unit }: TrendSparklineProps) {
  if (trends.length === 0) return null;

  const values = trends.map(t => t[field] as number | null);
  const labels = trends.map(t => {
    const d = new Date(t.date + "T00:00:00");
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  });

  const chip = deltaChip(trends, field);
  const hasData = values.some(v => v != null);
  if (!hasData) return null;

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label} — 14 days
        </p>
        {chip && (
          <span className={`text-[10px] font-semibold ${chip.color}`}>{chip.text}</span>
        )}
      </div>
      <div style={{ height: 72 }}>
        <Line
          data={{
            labels,
            datasets: [{
              data: values,
              borderColor: color,
              backgroundColor: color + "18",
              fill: true,
              tension: 0.4,
              pointRadius: values.map((v, i) => i === values.length - 1 ? 3 : 0),
              pointBackgroundColor: color,
              spanGaps: true,
            }],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: ctx => `${ctx.parsed.y}${unit ? ` ${unit}` : ""}`,
                },
              },
            },
            scales: {
              x: {
                ticks: { color: "#6b7280", font: { size: 9 }, maxRotation: 0 },
                grid: { display: false },
                border: { display: false },
              },
              y: {
                ticks: { display: false },
                grid: { color: "#ffffff08" },
                border: { display: false },
              },
            },
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/health/trend-sparkline.tsx
git commit -m "Add TrendSparkline component — 14-day line chart with delta chip"
```

---

## Task 4: Update Sleep detail page

**Files:**
- Modify: `app/health/sleep/page.tsx`

Replace the sticky plain header with `DetailHero` (theme=`"sleep"`). Move `LargeScoreArc` inside the hero's children slot. Add a `TrendSparkline` for `sleepScore`. Remove the now-unused sticky header div.

- [ ] **Step 1: Rewrite the file**

```typescript
// app/health/sleep/page.tsx
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_LONG } from "@/components/sync-provider";
import { todayInTz, DEFAULT_TZ } from "@/lib/date-utils";
import type { ReadinessScoreResponse } from "@/app/api/readiness-score/route";
import type { HealthTrendsResponse } from "@/app/api/health/trends/route";
import { DetailHero } from "@/components/health/detail-hero";
import { TrendSparkline } from "@/components/health/trend-sparkline";

const AiInsightCard = dynamic(() => import("@/components/health/ai-insight-card").then(m => ({ default: m.AiInsightCard })), { ssr: false });

function bandColor(score: number | null) {
  if (score == null) return "rgba(255,255,255,0.7)";
  if (score >= 70) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function LargeScoreArc({ score }: { score: number | null }) {
  const color = bandColor(score);
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const offset = score != null ? circumference * (1 - score / 100) : circumference;
  return (
    <div className="relative w-32 h-32">
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="8" stroke="rgba(255,255,255,0.12)" />
        <circle
          cx="60" cy="60" r={r} fill="none" strokeWidth="8"
          style={{ stroke: color, strokeDasharray: circumference, strokeDashoffset: offset, strokeLinecap: "round" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>{score ?? "—"}</span>
        <span className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.6)" }}>Sleep Score</span>
      </div>
    </div>
  );
}

function ContributorBars({ contributors }: { contributors: Record<string, number | null> }) {
  const entries = Object.entries(contributors).filter(([, v]) => v != null).sort(([, a], [, b]) => (a ?? 0) - (b ?? 0));
  if (entries.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sleep Contributors</p>
      {entries.map(([key, val]) => {
        const pct = val ?? 0;
        const color = pct >= 70 ? "#22c55e" : pct >= 45 ? "#f59e0b" : "#ef4444";
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-32 flex-none capitalize">{key.replace(/_/g, " ")}</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-muted/60">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="text-[10px] font-semibold tabular-nums w-5 text-right" style={{ color }}>{val}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function SleepDetailPage() {
  const today = todayInTz(DEFAULT_TZ);
  const [data, setData] = useState<ReadinessScoreResponse | null>(
    () => readCacheSync<ReadinessScoreResponse>("readiness-score")
  );
  const [trends, setTrends] = useState<HealthTrendsResponse | null>(
    () => readCacheSync<HealthTrendsResponse>("health-trends")
  );

  useEffect(() => {
    cachedFetch<ReadinessScoreResponse>("readiness-score", "/api/readiness-score", TTL_LONG, d => {
      if (d) setData(d);
    });
    cachedFetch<HealthTrendsResponse>("health-trends", "/api/health/trends", TTL_LONG, d => {
      if (d) setTrends(d);
    });
  }, []);

  const sleepScore = data?.sleepScore ?? null;

  return (
    <div className="min-h-screen bg-background pb-safe">
      <DetailHero theme="sleep" title="Sleep">
        <LargeScoreArc score={sleepScore} />
      </DetailHero>

      <div className="px-4 py-5 space-y-5">
        {trends?.trends && (
          <TrendSparkline trends={trends.trends} field="sleepScore" label="Sleep Score" color="#818cf8" />
        )}

        {data?.sleepContributors && (
          <ContributorBars contributors={data.sleepContributors} />
        )}

        {data?.recommendedBedtimeStart != null && (
          <div className="rounded-xl border border-border bg-muted/20 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Recommended Bedtime</p>
            <p className="text-base font-semibold">
              {new Date(data.recommendedBedtimeStart * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {data.recommendedBedtimeEnd != null && (
                <span className="text-muted-foreground"> – {new Date(data.recommendedBedtimeEnd * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              )}
            </p>
            {data.sleepTimeStatus && (
              <p className="text-xs text-muted-foreground mt-1 capitalize">{data.sleepTimeStatus.replace(/_/g, " ")}</p>
            )}
          </div>
        )}

        <AiInsightCard section="sleep" date={today} />

        {!data && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/health/sleep/page.tsx
git commit -m "Sleep detail page — night sky hero background + 14-day trend sparkline"
```

---

## Task 5: Update Readiness detail page

**Files:**
- Modify: `app/health/readiness/page.tsx`

- [ ] **Step 1: Rewrite the file**

```typescript
// app/health/readiness/page.tsx
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_LONG } from "@/components/sync-provider";
import { todayInTz, DEFAULT_TZ } from "@/lib/date-utils";
import type { ReadinessScoreResponse } from "@/app/api/readiness-score/route";
import type { HealthTrendsResponse } from "@/app/api/health/trends/route";
import { DetailHero } from "@/components/health/detail-hero";
import { TrendSparkline } from "@/components/health/trend-sparkline";

const AiInsightCard = dynamic(() => import("@/components/health/ai-insight-card").then(m => ({ default: m.AiInsightCard })), { ssr: false });

function bandColor(score: number | null) {
  if (score == null) return "rgba(255,255,255,0.7)";
  if (score >= 70) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function bandLabel(score: number | null) {
  if (score == null) return "—";
  if (score >= 70) return "High";
  if (score >= 50) return "Moderate";
  return "Low";
}

function LargeScoreArc({ score }: { score: number | null }) {
  const color = bandColor(score);
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const offset = score != null ? circumference * (1 - score / 100) : circumference;
  return (
    <div className="relative w-32 h-32">
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="8" stroke="rgba(255,255,255,0.12)" />
        <circle
          cx="60" cy="60" r={r} fill="none" strokeWidth="8"
          style={{ stroke: color, strokeDasharray: circumference, strokeDashoffset: offset, strokeLinecap: "round" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>{score ?? "—"}</span>
        <span className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.6)" }}>{score != null ? bandLabel(score) : ""}</span>
      </div>
    </div>
  );
}

function ContributorBars({ title, contributors }: { title: string; contributors: Record<string, number | null> }) {
  const entries = Object.entries(contributors).filter(([, v]) => v != null).sort(([, a], [, b]) => (a ?? 0) - (b ?? 0));
  if (entries.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {entries.map(([key, val]) => {
        const pct = val ?? 0;
        const color = pct >= 70 ? "#22c55e" : pct >= 45 ? "#f59e0b" : "#ef4444";
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-32 flex-none capitalize">{key.replace(/_/g, " ")}</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-muted/60">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="text-[10px] font-semibold tabular-nums w-5 text-right" style={{ color }}>{val}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function ReadinessDetailPage() {
  const today = todayInTz(DEFAULT_TZ);
  const [data, setData] = useState<ReadinessScoreResponse | null>(
    () => readCacheSync<ReadinessScoreResponse>("readiness-score")
  );
  const [trends, setTrends] = useState<HealthTrendsResponse | null>(
    () => readCacheSync<HealthTrendsResponse>("health-trends")
  );

  useEffect(() => {
    cachedFetch<ReadinessScoreResponse>("readiness-score", "/api/readiness-score", TTL_LONG, d => {
      if (d) setData(d);
    });
    cachedFetch<HealthTrendsResponse>("health-trends", "/api/health/trends", TTL_LONG, d => {
      if (d) setTrends(d);
    });
  }, []);

  const color = bandColor(data?.ouraScore ?? null);

  return (
    <div className="min-h-screen bg-background pb-safe">
      <DetailHero theme="readiness" title="Readiness">
        <LargeScoreArc score={data?.ouraScore ?? null} />
      </DetailHero>

      <div className="px-4 py-5 space-y-5">
        {trends?.trends && (
          <TrendSparkline trends={trends.trends} field="readinessScore" label="Readiness Score" color="#fb923c" />
        )}

        {data?.daySummary && (
          <div className="rounded-xl border border-border bg-muted/20 p-4">
            <p className="text-sm text-muted-foreground">{data.daySummary}</p>
          </div>
        )}

        {data?.readinessContributors && (
          <ContributorBars title="Readiness Contributors" contributors={data.readinessContributors} />
        )}

        {data?.temperatureDeviation != null && (
          <div className="rounded-xl border border-border bg-muted/20 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Temperature Deviation</p>
            <p className="text-xl font-bold tabular-nums" style={{ color }}>
              {data.temperatureDeviation > 0 ? "+" : ""}{data.temperatureDeviation.toFixed(2)}°C
            </p>
          </div>
        )}

        <AiInsightCard section="readiness" date={today} />

        {!data && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/health/readiness/page.tsx
git commit -m "Readiness detail page — sunrise hero background + 14-day trend sparkline"
```

---

## Task 6: Update Activity detail page

**Files:**
- Modify: `app/health/activity/page.tsx`

- [ ] **Step 1: Rewrite the file**

```typescript
// app/health/activity/page.tsx
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_LONG } from "@/components/sync-provider";
import { todayInTz, DEFAULT_TZ } from "@/lib/date-utils";
import type { ReadinessScoreResponse } from "@/app/api/readiness-score/route";
import type { HealthTrendsResponse } from "@/app/api/health/trends/route";
import { DetailHero } from "@/components/health/detail-hero";
import { TrendSparkline } from "@/components/health/trend-sparkline";

const AiInsightCard = dynamic(() => import("@/components/health/ai-insight-card").then(m => ({ default: m.AiInsightCard })), { ssr: false });

function bandColor(score: number | null) {
  if (score == null) return "rgba(255,255,255,0.7)";
  if (score >= 70) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function LargeScoreArc({ score }: { score: number | null }) {
  const color = bandColor(score);
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const offset = score != null ? circumference * (1 - score / 100) : circumference;
  return (
    <div className="relative w-32 h-32">
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="8" stroke="rgba(255,255,255,0.12)" />
        <circle
          cx="60" cy="60" r={r} fill="none" strokeWidth="8"
          style={{ stroke: color, strokeDasharray: circumference, strokeDashoffset: offset, strokeLinecap: "round" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>{score ?? "—"}</span>
        <span className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.6)" }}>Activity Score</span>
      </div>
    </div>
  );
}

function ContributorBars({ contributors }: { contributors: Record<string, number | null> }) {
  const entries = Object.entries(contributors).filter(([, v]) => v != null).sort(([, a], [, b]) => (a ?? 0) - (b ?? 0));
  if (entries.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Activity Contributors</p>
      {entries.map(([key, val]) => {
        const pct = val ?? 0;
        const color = pct >= 70 ? "#22c55e" : pct >= 45 ? "#f59e0b" : "#ef4444";
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-32 flex-none capitalize">{key.replace(/_/g, " ")}</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-muted/60">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="text-[10px] font-semibold tabular-nums w-5 text-right" style={{ color }}>{val}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function ActivityDetailPage() {
  const today = todayInTz(DEFAULT_TZ);
  const [data, setData] = useState<ReadinessScoreResponse | null>(
    () => readCacheSync<ReadinessScoreResponse>("readiness-score")
  );
  const [trends, setTrends] = useState<HealthTrendsResponse | null>(
    () => readCacheSync<HealthTrendsResponse>("health-trends")
  );

  useEffect(() => {
    cachedFetch<ReadinessScoreResponse>("readiness-score", "/api/readiness-score", TTL_LONG, d => {
      if (d) setData(d);
    });
    cachedFetch<HealthTrendsResponse>("health-trends", "/api/health/trends", TTL_LONG, d => {
      if (d) setTrends(d);
    });
  }, []);

  return (
    <div className="min-h-screen bg-background pb-safe">
      <DetailHero theme="activity" title="Activity">
        <LargeScoreArc score={data?.activityScore ?? null} />
      </DetailHero>

      <div className="px-4 py-5 space-y-5">
        {trends?.trends && (
          <TrendSparkline trends={trends.trends} field="activityScore" label="Activity Score" color="#34d399" />
        )}

        {data?.activityContributors && (
          <ContributorBars contributors={data.activityContributors} />
        )}

        {data?.stressHigh != null && data?.recoveryHigh != null && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-muted/20 p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Stress</p>
              <p className="text-xl font-bold tabular-nums mt-1">{Math.round(data.stressHigh)} <span className="text-xs font-normal text-muted-foreground">min</span></p>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Recovery</p>
              <p className="text-xl font-bold tabular-nums mt-1">{Math.round(data.recoveryHigh)} <span className="text-xs font-normal text-muted-foreground">min</span></p>
            </div>
          </div>
        )}

        <AiInsightCard section="activity" date={today} />

        {!data && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/health/activity/page.tsx
git commit -m "Activity detail page — forest green hero background + 14-day trend sparkline"
```

---

## Task 7: Update Heart Rate detail page

**Files:**
- Modify: `app/health/heart-rate/page.tsx`

The heart rate page shows RHR (resting heart rate) and HRV trends rather than a score trend.

- [ ] **Step 1: Rewrite the file**

```typescript
// app/health/heart-rate/page.tsx
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { HeartIcon } from "lucide-react";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_LONG } from "@/components/sync-provider";
import { todayInTz, DEFAULT_TZ } from "@/lib/date-utils";
import type { ReadinessScoreResponse } from "@/app/api/readiness-score/route";
import type { HealthTrendsResponse } from "@/app/api/health/trends/route";
import { DetailHero } from "@/components/health/detail-hero";
import { TrendSparkline } from "@/components/health/trend-sparkline";

const AiInsightCard = dynamic(() => import("@/components/health/ai-insight-card").then(m => ({ default: m.AiInsightCard })), { ssr: false });

export default function HeartRateDetailPage() {
  const today = todayInTz(DEFAULT_TZ);
  const [data, setData] = useState<ReadinessScoreResponse | null>(
    () => readCacheSync<ReadinessScoreResponse>("readiness-score")
  );
  const [trends, setTrends] = useState<HealthTrendsResponse | null>(
    () => readCacheSync<HealthTrendsResponse>("health-trends")
  );

  useEffect(() => {
    cachedFetch<ReadinessScoreResponse>("readiness-score", "/api/readiness-score", TTL_LONG, d => {
      if (d) setData(d);
    });
    cachedFetch<HealthTrendsResponse>("health-trends", "/api/health/trends", TTL_LONG, d => {
      if (d) setTrends(d);
    });
  }, []);

  const hr = data?.hrCurrent ?? null;
  const hrColor = hr != null
    ? hr < 60 ? "#22c55e" : hr < 100 ? "#f87171" : "#f59e0b"
    : "rgba(255,255,255,0.7)";

  const stats = [
    { label: "Current", value: data?.hrCurrent, unit: "bpm" },
    { label: "Min",     value: data?.hrMin,     unit: "bpm" },
    { label: "Average", value: data?.hrAvg,     unit: "bpm" },
    { label: "Max",     value: data?.hrMax,     unit: "bpm" },
  ];

  return (
    <div className="min-h-screen bg-background pb-safe">
      <DetailHero theme="heart-rate" title="Heart Rate">
        <div className="flex flex-col items-center gap-1">
          <HeartIcon className="h-8 w-8 mb-1" style={{ color: hrColor }} />
          <span className="text-4xl font-bold tabular-nums" style={{ color: hrColor }}>
            {hr ?? "—"}
          </span>
          <span className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>bpm current</span>
        </div>
      </DetailHero>

      <div className="px-4 py-5 space-y-5">
        <div className="grid grid-cols-2 gap-3">
          {stats.map(s => (
            <div key={s.label} className="rounded-xl border border-border bg-muted/20 p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold tabular-nums mt-1">
                {s.value != null ? s.value : "—"}
                {s.value != null && <span className="text-xs font-normal text-muted-foreground ml-1">{s.unit}</span>}
              </p>
            </div>
          ))}
        </div>

        {trends?.trends && (
          <>
            <TrendSparkline trends={trends.trends} field="rhrBpm" label="Resting Heart Rate" color="#f87171" unit="bpm" />
            <TrendSparkline trends={trends.trends} field="hrvMs" label="HRV" color="#a78bfa" unit="ms" />
          </>
        )}

        {(data?.vo2Max != null || data?.vascularAge != null) && (
          <div className="grid grid-cols-2 gap-3">
            {data.vo2Max != null && (
              <div className="rounded-xl border border-border bg-muted/20 p-4 text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">VO₂ Max</p>
                <p className="text-xl font-bold tabular-nums mt-1">{data.vo2Max}</p>
              </div>
            )}
            {data.vascularAge != null && (
              <div className="rounded-xl border border-border bg-muted/20 p-4 text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Vascular Age</p>
                <p className="text-xl font-bold tabular-nums mt-1">{data.vascularAge} <span className="text-xs font-normal text-muted-foreground">yrs</span></p>
              </div>
            )}
          </div>
        )}

        <AiInsightCard section="heart-rate" date={today} />

        {!data && (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/health/heart-rate/page.tsx
git commit -m "Heart rate detail page — crimson hero background + RHR/HRV 14-day trend sparklines"
```

---

## Task 8: TypeScript check + push

- [ ] **Step 1: Run TypeScript check**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: no errors. If errors appear, fix them before continuing. Common fixes:
- Missing `toAestDay` import in `app/api/health/trends/route.ts` — check the export in `lib/date-utils.ts`
- `BodyMetrics.restingHeartRate` name mismatch — look up the exact field name in `lib/data/repository.ts`

- [ ] **Step 2: Start dev server and spot-check the UI**

```bash
cd /home/user/TrainingAI && pnpm dev &
```

Then open each page and verify:
- `http://localhost:3000/health/sleep` — dark navy/star background visible, score arc centred, trend sparkline below
- `http://localhost:3000/health/readiness` — warm orange/violet sunrise background, readiness score, trend sparkline
- `http://localhost:3000/health/activity` — forest green background, activity score, trend sparkline
- `http://localhost:3000/health/heart-rate` — deep crimson background, bpm display, RHR + HRV sparklines

Check that:
1. The back button (← with title) is visible over the gradient
2. The gradient fades naturally into the dark card area below
3. The score arc ring track uses `rgba(255,255,255,0.12)` (white ghost) not the dark muted class
4. Trend sparklines appear (may show empty if no Oura data in local dev DB — that's fine)
5. No crash on pages with null Oura data

- [ ] **Step 3: Push branch**

```bash
git push -u origin claude/activity-backgrounds-history-tjoi49
```

---

## Self-review

**Spec coverage check:**
- ✅ Unique background per page — DetailHero with per-theme CSS gradients
- ✅ Sleep → moon/night sky — deep navy, stars SVG, crescent moon
- ✅ Readiness → sunrise — violet→orange→amber gradient + ray decoration
- ✅ Activity → nature/outdoor — forest green gradient + rolling hills SVG
- ✅ Heart Rate → pulse/red — deep crimson + ECG line decoration
- ✅ Not plain black — all gradients start from very dark but chromatic (navy, violet, green, red)
- ✅ Historical data — 14-day trend sparklines on all 4 pages
- ✅ Delta chips — "▲ +N vs last week" / "▼ −N vs last week" on each sparkline
- ✅ New API endpoint returns data without new DB tables or migrations

**Placeholder scan:** none found.

**Type consistency:**
- `HealthTrendDay` defined in `app/api/health/trends/route.ts`, imported by `TrendSparkline` and all 4 pages ✅
- `DetailHero` props `{ theme: HeroTheme, title: string, children: React.ReactNode }` — used identically in all 4 pages ✅
- `TrendSparkline` prop `field: Field` values used: `"readinessScore"`, `"sleepScore"`, `"activityScore"`, `"rhrBpm"`, `"hrvMs"` — all present in `HealthTrendDay` ✅

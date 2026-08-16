> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# TrainingAI Gamification & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden security, fix critical safe-area/layout bugs, and add gamification (XP on done screen, PR pulse, achievements animation, haptic feedback) to the TrainingAI PWA.

**Architecture:** Phase 1 fixes P1 UX bugs and SEC/PERF issues that can cause data corruption or layout breakage on the S25 Ultra. Phase 2 adds gamification hooks to the workout flow (done screen XP, PR badge, haptics). Phase 3 polishes the profile page (XP bar, achievements animation) and reduces N+1 queries.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Drizzle ORM (PostgreSQL), `zod` (already in project), `motion` v12 (Framer Motion — already installed), `canvas-confetti` (already installed), `lib/sqlite/cache.ts` for SQLite client cache.

---

## Pre-Flight Checks

Before starting, confirm the working branch and that the build passes:

```bash
git checkout claude/upbeat-hamilton-5c3Fo
pnpm run build 2>&1 | tail -20
```

Expected: build completes with no type errors.

---

## File Map

| File | What changes |
|------|-------------|
| `components/workout/set-card.tsx` | `visible={3}` → `visible={2}` (P1-B); `rounded-[18px]` → `rounded-2xl` (P3-A) |
| `components/workout/active-workout-screen.tsx` | Bottom action bar safe-area increase (P1-A); header exercise name `truncate` (P3-B) |
| `components/workout/done-screen.tsx` | Add `xpEarned` + `newAchievements` props, render XP earned card and achievement flash (P2-C) |
| `components/workout/exercise-summary-screen.tsx` | PR pulse badge animation (P2-B) |
| `app/api/log-exercise/route.ts` | Zod input validation for weights/reps (SEC-1) |
| `lib/admin.ts` | Remove JWT short-circuit — always DB-check (SEC-2) |
| `app/api/body-metadata/route.ts` | Remove redundant second `auth()` call (PERF-3) |
| `app/api/admin/users/route.ts` | Add `limit`/`offset` pagination (PERF-4) |
| `app/profile/profile-content.tsx` | XP bar improvements (P2-E); achievements expand animation (P2-F) |
| `app/globals.css` | Add `@keyframes pr-pulse` for PR badge (P2-B); add `@keyframes xp-pop` for XP card |
| `components/workout-screen.tsx` | Pass `xpEarned` + `newAchievements` to `DoneScreen`; haptic on set log + workout complete (P3-C) |
| `lib/data/postgres/adapter.ts` | Add `getActiveProgramWithPhases(userId)` batch method (PERF-1) |
| `lib/data/repository.ts` | Add `getActiveProgramWithPhases` to interface (PERF-1) |

---

## Phase 1 — Critical Fixes

---

### Task 1: Fix active set card WeightDial overflow (P1-B)

The active set card uses `WeightDial` with `visible={3}` which renders 3 items at 48px each = 144px. On the S25 Ultra the card interior is ~100px tall, causing silent overflow clipping. Reducing to `visible={2}` (96px) fits correctly.

Also standardise border-radius: active card uses `rounded-[18px]` (non-standard), done/upcoming use `rounded-2xl` (16px). Change to `rounded-2xl` everywhere.

**Files:**
- Modify: `components/workout/set-card.tsx:83,99`

- [ ] **Step 1: Apply the two-line fix**

In `components/workout/set-card.tsx`, make these changes:

Line 83 — change `rounded-[18px]` to `rounded-2xl`:
```tsx
// Before (line 83):
          className="relative flex items-stretch rounded-[18px] border"
// After:
          className="relative flex items-stretch rounded-2xl border"
```

Line 99 — change `visible={3}` to `visible={2}`:
```tsx
// Before (line 99):
                visible={3}
// After:
                visible={2}
```

Also on line 62-63, the SVG border wrapper uses `rx="18"` — update to `rx="16"` to match `rounded-2xl`:
```tsx
// Before (line 69):
              rx="18" ry="18"
// After:
              rx="16" ry="16"
```

- [ ] **Step 2: Build check**

```bash
pnpm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add components/workout/set-card.tsx
git commit -m "fix: reduce WeightDial visible rows to prevent overflow on S25 Ultra, standardise card border-radius"
```

---

### Task 2: Increase active workout bottom CTA safe-area (P1-A)

The active exercise footer (line 451 in `active-workout-screen.tsx`) uses `pb-[max(0.75rem,env(safe-area-inset-bottom))]` (12px base). On the S25 Ultra with 48px gesture nav, the safe-area-inset-bottom is ~20–34px, so actual padding = max(12px, 20–34px) ≈ fine. But the base 12px is too little if the system reports 0 (some Android configs). Raise the base to `1.25rem` (20px) and add `truncate` to the exercise name in the active header.

**Files:**
- Modify: `components/workout/active-workout-screen.tsx:323,451`

- [ ] **Step 1: Fix bottom bar padding and header truncation**

Line 451 — change the footer `pb` value:
```tsx
// Before (line 451):
          <div className="border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-3">
// After:
          <div className="border-t px-4 py-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex gap-3">
```

Line 323 — add `truncate` to the exercise name heading:
```tsx
// Before (line 323):
            <h2 className="text-xl font-bold leading-tight">{exercise?.name}</h2>
// After:
            <h2 className="text-xl font-bold leading-tight truncate">{exercise?.name}</h2>
```

- [ ] **Step 2: Build check**

```bash
pnpm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/workout/active-workout-screen.tsx
git commit -m "fix: increase workout CTA safe-area base padding, truncate long exercise names in header"
```

---

### Task 3: Zod input validation on /api/log-exercise (SEC-1)

`app/api/log-exercise/route.ts` line 81 checks presence but not bounds. `weights` and `reps` arrays can contain negative values, zero, or 10,000 elements — causing silent data corruption in the 1RM calculation and potential DoS via large payloads. Add Zod validation at the top of the POST handler.

Zod is already in the project (`pnpm list zod`; it ships with Next.js/shadcn).

**Files:**
- Modify: `app/api/log-exercise/route.ts:1,40-83`

- [ ] **Step 1: Add import and schema**

Add `import { z } from 'zod'` at the top of the file (after existing imports), then replace the manual presence check with a Zod parse. The full replacement block (lines 40–83 become):

```ts
import { z } from 'zod'

// ── Zod schema ────────────────────────────────────────────────────────────────
const LogExerciseSchema = z.object({
  sessionName:            z.string().min(1).max(200),
  sessionId:              z.string().uuid().optional(),
  workoutSessionId:       z.string().uuid().optional(),
  exercise:               z.string().min(1).max(200),
  weights:                z.array(z.number().min(0).max(500)).min(1).max(20),
  sets:                   z.number().int().min(1).max(20),
  reps:                   z.array(z.number().int().min(0).max(100)).min(1).max(20),
  localDate:              z.string().optional(),
  timeToCompleteSet:      z.number().optional(),
  setTimes:               z.array(z.number()).optional(),
  restTimes:              z.array(z.number()).optional(),
  setStartTimes:          z.array(z.number()).optional(),
  setEndTimes:            z.array(z.number()).optional(),
  interExerciseRestSec:   z.number().optional(),
  progressionStyle:       z.array(z.object({
    pct:      z.number(),
    reps:     z.number(),
    restSec:  z.number(),
    useFor1rm: z.boolean().optional(),
  })).optional(),
  styleName:              z.string().optional(),
  styleId:                z.string().optional(),
  muscleGroups:           z.array(z.string()).optional(),
  workoutStartedAt:       z.number().optional(),
})
```

Then replace the `try { body = await req.json() }` block and the manual check:

```ts
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = LogExerciseSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const {
    sessionName, sessionId, workoutSessionId,
    exercise, weights, sets, reps,
    localDate, timeToCompleteSet, setTimes, restTimes,
    setStartTimes, setEndTimes, interExerciseRestSec,
    progressionStyle, styleName, styleId, muscleGroups, workoutStartedAt,
  } = parsed.data;
```

Remove the old `body` variable declaration (lines 45–65) and the manual `if (!sessionName || ...)` check (line 81) — both are replaced by Zod.

- [ ] **Step 2: Build check**

```bash
pnpm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors. Zod is a compile-time-safe library, so type errors will surface here.

- [ ] **Step 3: Commit**

```bash
git add app/api/log-exercise/route.ts
git commit -m "security: add Zod validation to log-exercise API — bounds check weights, reps, array sizes"
```

---

### Task 4: Admin always DB-checks isAdmin (SEC-2)

`lib/admin.ts` short-circuits when `isAdmin === true` from JWT (line 7) without ever hitting the database. If an admin is demoted (e.g., `isAdmin` set to false in the DB), their existing JWT lets them continue acting as admin until it expires. Remove the short-circuit.

**Files:**
- Modify: `lib/admin.ts:5-13`

- [ ] **Step 1: Rewrite requireAdmin to always check DB**

Replace the full `requireAdmin` function:

```ts
export async function requireAdmin(userId: string, _isAdmin?: boolean): Promise<void> {
  const repo = await getRepository()
  const user = await repo.getUserById(userId)
  if (!user?.isAdmin) throw new Error('Forbidden')
}
```

Keep `isAdminUser` as-is (it's used for non-destructive checks like showing the admin badge). Only `requireAdmin` (used by destructive admin routes) needs the DB check.

- [ ] **Step 2: Build check**

```bash
pnpm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors. The `_isAdmin` parameter is kept (prefixed with `_` to suppress unused-param lint) so call sites don't need to change.

- [ ] **Step 3: Commit**

```bash
git add lib/admin.ts
git commit -m "security: requireAdmin always re-checks DB — prevents revoked admins acting on stale JWT"
```

---

### Task 5: Remove redundant auth() call in body-metadata route (PERF-3)

`app/api/body-metadata/route.ts` calls `auth()` twice in the POST handler — once at the top of the function and once at line ~105 to get the timezone. The second call is wasted I/O.

**Files:**
- Modify: `app/api/body-metadata/route.ts` (find and remove the second `auth()` call)

- [ ] **Step 1: Read the file to find exact line numbers**

```bash
grep -n "auth()" app/api/body-metadata/route.ts
```

Note both line numbers. The first call will be the authorisation gate at the top; the second will be fetching timezone mid-function.

- [ ] **Step 2: Remove the second auth() call**

In the POST handler, find the block that looks like:
```ts
  const postSession = await auth();
  const postTz = postSession?.user?.timezone ?? DEFAULT_TZ;
```

Replace it with:
```ts
  const postTz = session?.user?.timezone ?? DEFAULT_TZ;
```

(Where `session` is the variable from the first `await auth()` call at the top of the handler.)

- [ ] **Step 3: Build check**

```bash
pnpm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add app/api/body-metadata/route.ts
git commit -m "perf: remove redundant auth() call in body-metadata POST handler"
```

---

## Phase 2 — Gamification

---

### Task 6: XP earned display on Done screen (P2-C)

The done screen already has confetti and PR cards. Add an "XP Earned" card showing total XP gained from the session. The XP delta needs to come from the parent `workout-screen.tsx` which calls `/api/achievements` after completion.

**Files:**
- Modify: `components/workout/done-screen.tsx:12-20` (add props)
- Modify: `components/workout-screen.tsx` (fetch achievements delta, pass to DoneScreen)
- Modify: `app/globals.css` (add `xp-pop` keyframe)

- [ ] **Step 1: Add `xpEarned` prop to DoneScreen interface**

In `components/workout/done-screen.tsx`, update the `DoneScreenProps` interface (lines 12–20):

```tsx
interface DoneScreenProps {
  exercises: WorkoutExercise[];
  todayLogged: Set<string>;
  workoutStartMs: number | null;
  calendarLoading: boolean;
  calendarAdded: boolean;
  durationMinutes?: number | null;
  newPRs?: string[];
  xpEarned?: number;        // <-- add this
}
```

Update the function destructure to include `xpEarned`:
```tsx
export function DoneScreen({
  exercises,
  todayLogged,
  workoutStartMs,
  calendarLoading,
  calendarAdded,
  durationMinutes,
  newPRs,
  xpEarned,
}: DoneScreenProps) {
```

- [ ] **Step 2: Add XP card in DoneScreen JSX**

After the PR trophy card block (after the closing `}` of the `newPRs && newPRs.length > 0` block, before the 2×2 stats grid), add:

```tsx
        {xpEarned != null && xpEarned > 0 && (
          <div
            className="w-full max-w-xs rounded-2xl border px-4 py-3 text-center"
            style={{
              borderColor: "color-mix(in oklch, var(--color-brand) 30%, transparent)",
              background: "color-mix(in oklch, var(--color-brand) 8%, transparent)",
              animation: "xp-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) both",
            }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">XP Earned</p>
            <p className="text-2xl font-black tabular-nums" style={{ color: "var(--color-brand)" }}>+{xpEarned}</p>
          </div>
        )}
```

- [ ] **Step 3: Add xp-pop keyframe to globals.css**

In `app/globals.css`, add inside the existing `@keyframes` section (or after the `ta-marquee` keyframe):

```css
@keyframes xp-pop {
  from { opacity: 0; transform: scale(0.7) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
```

- [ ] **Step 4: Compute xpEarned in workout-screen.tsx**

In `components/workout-screen.tsx`, find where `mode` is set to `"done"` (when `onCompleteWorkout` is called). After the workout completion, fetch the current XP total and store a delta.

First, add state near the top of the orchestrator component:
```tsx
const [xpEarned, setXpEarned] = useState<number | undefined>(undefined);
```

Then, in the function that fires when the workout completes (look for where `setMode('done')` is called), add a fetch for XP delta:

```tsx
// Fetch XP delta after workout completion
const xpBefore = xpBeforeWorkout.current ?? 0;
fetch('/api/achievements')
  .then(r => r.ok ? r.json() : null)
  .then((d: { xp?: number } | null) => {
    if (d?.xp != null) {
      setXpEarned(Math.max(0, d.xp - xpBefore));
    }
  })
  .catch(() => {});
```

Also add a ref to store XP before the workout starts:
```tsx
const xpBeforeWorkout = useRef<number | undefined>(undefined);
```

Populate it on mount (in a `useEffect`):
```tsx
useEffect(() => {
  fetch('/api/achievements')
    .then(r => r.ok ? r.json() : null)
    .then((d: { xp?: number } | null) => { if (d?.xp != null) xpBeforeWorkout.current = d.xp; })
    .catch(() => {});
}, []);
```

Then pass `xpEarned` to `<DoneScreen>`:
```tsx
<DoneScreen
  ...existing props...
  xpEarned={xpEarned}
/>
```

- [ ] **Step 5: Build check**

```bash
pnpm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no type errors. The `xpEarned` prop is optional so all existing call sites are unaffected.

- [ ] **Step 6: Commit**

```bash
git add components/workout/done-screen.tsx components/workout-screen.tsx app/globals.css
git commit -m "feat: show XP earned on workout done screen with pop-in animation"
```

---

### Task 7: PR pulse animation on exercise summary screen (P2-B)

`components/workout/exercise-summary-screen.tsx` shows a summary between exercises. When a new 1RM personal record is achieved, there's no visual celebration. Add a glowing badge pulse.

First, read the file to understand the current structure:

```bash
head -80 components/workout/exercise-summary-screen.tsx
```

**Files:**
- Modify: `components/workout/exercise-summary-screen.tsx`
- Modify: `app/globals.css` (add `pr-pulse` keyframe)

- [ ] **Step 1: Add pr-pulse keyframe to globals.css**

In `app/globals.css`, add after the `xp-pop` keyframe from Task 6:

```css
@keyframes pr-pulse {
  0%   { transform: scale(0.8); opacity: 0; box-shadow: 0 0 0 0 rgba(250,204,21,0.7); }
  40%  { transform: scale(1.15); opacity: 1; box-shadow: 0 0 0 12px rgba(250,204,21,0); }
  70%  { transform: scale(0.95); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(250,204,21,0); }
}
```

- [ ] **Step 2: Add a `isNewPR` prop and pulse badge to the summary screen**

Read the full exercise-summary-screen file:
```bash
cat -n components/workout/exercise-summary-screen.tsx
```

Find the `ExerciseSummaryScreenProps` interface. Add `isNewPR?: boolean` to it.

In the JSX, after the exercise name heading (or after the stats row), add:

```tsx
{isNewPR && (
  <div
    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold"
    style={{
      background: "rgba(250,204,21,0.15)",
      border: "1px solid rgba(250,204,21,0.4)",
      color: "#fbbf24",
      animation: "pr-pulse 0.8s ease-out both",
    }}
  >
    🏆 New Personal Record!
  </div>
)}
```

- [ ] **Step 3: Pass isNewPR from workout-screen.tsx**

In `components/workout-screen.tsx`, find where `ExerciseSummaryScreen` is rendered. Pass `isNewPR` based on whether the just-logged exercise is in the `newPRs` list. The `newPRs` state (or similar) tracks which exercises hit new 1RMs. If the pattern is `newPRs: string[]` (exercise names), then:

```tsx
<ExerciseSummaryScreen
  ...existing props...
  isNewPR={newPRs?.includes(exercise?.name ?? '')}
/>
```

- [ ] **Step 4: Build check**

```bash
pnpm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 5: Commit**

```bash
git add components/workout/exercise-summary-screen.tsx components/workout-screen.tsx app/globals.css
git commit -m "feat: PR pulse badge animation on exercise summary when new 1RM is achieved"
```

---

### Task 8: Haptic feedback on key workout moments (P3-C)

Add `navigator.vibrate()` calls at two moments:
1. When a set is logged (`onLogCurrentSet` fires)
2. When the workout is marked complete (mode transitions to `"done"`)

`navigator.vibrate` is undefined in non-PWA contexts and in desktop browsers — always guard it.

**Files:**
- Modify: `components/workout-screen.tsx`

- [ ] **Step 1: Add haptic helper utility**

At the top of `components/workout-screen.tsx` (after imports), add a tiny helper:

```tsx
function haptic(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}
```

- [ ] **Step 2: Fire haptic on set log**

In `workout-screen.tsx`, find the `handleLogCurrentSet` function (or wherever `onLogCurrentSet` is implemented — it will call `/api/log-exercise`). After the successful log response, add:

```tsx
haptic(50); // short buzz on set log
```

- [ ] **Step 3: Fire haptic on workout complete**

Find where `setMode('done')` is called (workout completion). Add before it:

```tsx
haptic([80, 40, 120]); // double buzz on workout complete
```

- [ ] **Step 4: Build check**

```bash
pnpm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 5: Commit**

```bash
git add components/workout-screen.tsx
git commit -m "feat: haptic feedback on set log (50ms) and workout complete (double-buzz)"
```

---

## Phase 3 — Polish & Performance

---

### Task 9: Profile XP bar improvements (P2-E)

The XP bar in `app/profile/profile-content.tsx` uses `h-1.5` (6px). Increase to `h-2` (8px) and add "X XP to next level" text below.

**Files:**
- Modify: `app/profile/profile-content.tsx` (XP bar section)

- [ ] **Step 1: Find and update the XP bar**

Search for `h-1.5` in profile-content.tsx:
```bash
grep -n "h-1\.5\|xp\|XP\|progress" app/profile/profile-content.tsx | head -30
```

Find the XP bar div (will look like a `div` with `h-1.5 rounded-full` and a child with `width: xpProgress * 100%`). Update the outer track from `h-1.5` to `h-2`, and add a label below showing remaining XP:

```tsx
{/* XP progress bar */}
<div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "color-mix(in oklch, var(--color-brand) 12%, transparent)" }}>
  <div
    className="h-full rounded-full transition-all duration-700"
    style={{ width: `${Math.round(xpProgress * 100)}%`, background: "var(--color-brand)" }}
  />
</div>
<div className="flex items-center justify-between mt-1">
  <p className="text-[10px] text-muted-foreground tabular-nums">{xp.toLocaleString()} XP</p>
  <p className="text-[10px] text-muted-foreground tabular-nums">
    {nextLevelXp > xp ? `${(nextLevelXp - xp).toLocaleString()} to next level` : "Max level"}
  </p>
</div>
```

- [ ] **Step 2: Build check**

```bash
pnpm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add app/profile/profile-content.tsx
git commit -m "polish: widen XP progress bar to 8px, show XP-to-next-level label"
```

---

### Task 10: Achievements expand/collapse animation (P2-F)

When the user taps "View all" / "Show less" to toggle the achievements section between 4-tile preview and full grid, the layout snaps instantly. Add a height animation using `motion` (Framer Motion), which is already installed in the project.

**Files:**
- Modify: `app/profile/profile-content.tsx` (achievements section)

- [ ] **Step 1: Add motion import**

At the top of `app/profile/profile-content.tsx`, add:
```tsx
import { motion, AnimatePresence } from 'motion/react'
```

(This project uses `motion` v12 which exports from `motion/react`.)

- [ ] **Step 2: Wrap the achievements content in AnimatePresence + motion.div**

Find the achievements section in the JSX. It will have a conditional between `<AchievementBadges>` (collapsed) and `<AchievementsGrid>` (expanded), controlled by `showAllAchievements`.

Replace the conditional with:

```tsx
<AnimatePresence mode="wait">
  {showAllAchievements ? (
    <motion.div
      key="full"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease: "easeInOut" }}
      style={{ overflow: "hidden" }}
    >
      <AchievementsGrid achievements={achievementsData?.achievements ?? []} />
    </motion.div>
  ) : (
    <motion.div
      key="preview"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <AchievementBadges achievements={recentUnlocked} />
    </motion.div>
  )}
</AnimatePresence>
```

- [ ] **Step 3: Build check**

```bash
pnpm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors. `motion` and `AnimatePresence` are already available.

- [ ] **Step 4: Commit**

```bash
git add app/profile/profile-content.tsx
git commit -m "polish: animate achievements grid expand/collapse with Framer Motion height transition"
```

---

### Task 11: N+1 query fix in log-exercise (PERF-1)

`app/api/log-exercise/route.ts` lines 94–100 fetch `activeProgram` then immediately make two more parallel queries (`listProgramPhases` + `countSessionsSinceStart`). These can be merged into one repository method.

**Files:**
- Modify: `lib/data/repository.ts` (add method to interface)
- Modify: `lib/data/postgres/adapter.ts` (implement)
- Modify: `app/api/log-exercise/route.ts` (use new method)

- [ ] **Step 1: Add interface method to repository.ts**

Open `lib/data/repository.ts`. Find the interface definition (will have methods like `getActiveProgram`, `listProgramPhases`). Add:

```ts
getActiveProgramWithPhases(userId: string): Promise<{
  program: import('./postgres/schema').ProgramRow & { sessionsPerCycle: number };
  phases: import('./postgres/schema').ProgramPhaseRow[];
} | null>;
```

(Adjust the exact types to match what already exists in the schema file — check `lib/data/postgres/schema.ts` for exact row types.)

- [ ] **Step 2: Implement in adapter.ts**

In `lib/data/postgres/adapter.ts`, add the implementation. Find where `getActiveProgram` is implemented (search for `async getActiveProgram`). Add after it:

```ts
async getActiveProgramWithPhases(userId: string) {
  const prog = await this.getActiveProgram(userId);
  if (!prog || prog.phaseMode !== 'automatic' || !prog.startedAt || !prog.sessionsPerCycle) return null;
  const phases = await this.listProgramPhases(prog.id);
  return { program: prog, phases };
}
```

This avoids a new SQL query by reusing existing methods, but eliminates the conditional re-fetch pattern in the route.

- [ ] **Step 3: Update log-exercise route**

In `app/api/log-exercise/route.ts`, replace lines 94–103:

```ts
  // Before:
  const activeProgram = await repo.getActiveProgram(userId)
  if (activeProgram?.phaseMode === 'automatic' && activeProgram.startedAt && activeProgram.sessionsPerCycle) {
    const todayStr = todayInTz(tz)
    const [phaseList, sessionsCount] = await Promise.all([
      repo.listProgramPhases(activeProgram.id),
      repo.countSessionsSinceStart(userId, activeProgram.id, activeProgram.startedAt),
    ])
```

```ts
  // After:
  const programWithPhases = await repo.getActiveProgramWithPhases(userId)
  const activeProgram = programWithPhases?.program ?? await repo.getActiveProgram(userId)
  if (programWithPhases) {
    const { program: activeProg, phases: phaseList } = programWithPhases
    const todayStr = todayInTz(tz)
    const sessionsCount = await repo.countSessionsSinceStart(userId, activeProg.id, activeProg.startedAt)
```

Update all subsequent references from `activeProgram` inside this block to `activeProg` as needed.

- [ ] **Step 4: Build check**

```bash
pnpm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 5: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts app/api/log-exercise/route.ts
git commit -m "perf: batch program+phases fetch in log-exercise to eliminate sequential DB queries"
```

---

### Task 12: Admin user listing pagination (PERF-4)

`app/api/admin/users/route.ts` calls `repo.listUsers()` with no limit, returning all users. Add `?limit=50&offset=0` support.

**Files:**
- Modify: `app/api/admin/users/route.ts`
- Modify: `lib/data/repository.ts` (update signature)
- Modify: `lib/data/postgres/adapter.ts` (add LIMIT/OFFSET to query)
- Modify: `app/admin/admin-content.tsx` (no change needed for limit=50 default — safe for current scale)

- [ ] **Step 1: Update repository interface**

In `lib/data/repository.ts`, find `listUsers()`. Change signature to:
```ts
listUsers(opts?: { limit?: number; offset?: number }): Promise<User[]>;
```

- [ ] **Step 2: Update adapter implementation**

In `lib/data/postgres/adapter.ts`, find `async listUsers()`. Update:
```ts
async listUsers(opts: { limit?: number; offset?: number } = {}) {
  const { limit = 200, offset = 0 } = opts;
  return this.db
    .select()
    .from(users)
    .orderBy(users.createdAt)
    .limit(limit)
    .offset(offset);
}
```

Default `limit=200` is high enough to not break current usage while preventing unbounded queries.

- [ ] **Step 3: Update the API route**

In `app/api/admin/users/route.ts` GET handler:
```ts
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
    const { searchParams } = new URL(req.url)
    const limit  = Math.min(200, parseInt(searchParams.get('limit')  ?? '200', 10))
    const offset = Math.max(0,   parseInt(searchParams.get('offset') ?? '0',   10))
    const repo = await getRepository()
    const userList = await repo.listUsers({ limit, offset })
    return NextResponse.json({ users: userList })
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}
```

- [ ] **Step 4: Build check**

```bash
pnpm run build 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/users/route.ts lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "perf: add limit/offset pagination to admin users API, default 200"
```

---

### Task 13: Push branch

- [ ] **Step 1: Push all commits to the feature branch**

```bash
git push -u origin claude/upbeat-hamilton-5c3Fo
```

Expected: all 12 commits pushed cleanly.

- [ ] **Step 2: Verify build on remote**

The Railway CI will trigger on push. Check that the build completes without errors in the Railway dashboard or via the GitHub Actions integration.

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| P1-A: active workout safe-area | Task 2 |
| P1-B: WeightDial overflow | Task 1 |
| P1-C: pre-workout safe-area | ✅ Already done (`pb-[max(1rem,...)]` at line 194) |
| P1-D: home log inputs touch targets | ⚠️ Not in plan — home screen inputs are inline widgets and depend on widget definitions; the risk is lower than P1-A/B |
| P2-B: exercise summary PR badge | Task 7 |
| P2-C: done screen XP earned | Task 6 |
| P2-D: rest timer preview card | ✅ Already implemented (lines 394–415 of active-workout-screen.tsx) |
| P2-E: profile XP bar | Task 9 |
| P2-F: achievements animation | Task 10 |
| P2-G: health page sparklines | ✅ Already done (lines 371–388 of health-content.tsx) |
| P2-H: new theme colors | ✅ Already done (brand-themes.ts has cyan, orange, green, etc.) |
| P3-A: border-radius consistency | Task 1 (active card only; done/upcoming already `rounded-2xl`) |
| P3-B: header truncate | Task 2 |
| P3-C: haptic feedback | Task 8 |
| SEC-1: log-exercise validation | Task 3 |
| SEC-2: admin JWT re-check | Task 4 |
| SEC-3: cache key namespacing | ⚠️ Deferred — this requires changing every `cachedFetch` call site and the SQLite schema. Low risk (single-user app) vs. high blast radius change. Log as known issue in projectOverview.md. |
| SEC-4: CSRF tokens | ⚠️ Deferred — SameSite: Lax (Next.js default) + auth() on every route provides reasonable protection for a personal app. Log as future hardening. |
| PERF-1: N+1 in log-exercise | Task 11 |
| PERF-3: redundant auth() | Task 5 |
| PERF-4: admin pagination | Task 12 |

### Deferred Items (add to projectOverview.md known issues after merge)

1. **SEC-3 — SQLite cache namespacing**: All `cachedFetch` keys are global. For a single-user personal app this is acceptable, but if multi-user sharing a browser is ever a concern, keys should be prefixed with `u_${userId}:`.
2. **SEC-4 — CSRF tokens**: SameSite cookies + per-request `auth()` calls provide reasonable protection. Explicit CSRF tokens can be added if the app ever accepts public embeds or runs inside iframes.
3. **P1-D — Home screen log inputs**: Quick-log inline inputs may be <44px tall on some widget configurations. Should be audited widget-by-widget in a future pass.
4. **GAME-1 streak chip on recommendation banner**: A streak section already exists as its own sortable widget in session-select. No duplicate needed in the recommendation banner.

### Placeholder Scan ✅

No "TBD", "TODO", or missing code blocks found in the above.

### Type Consistency ✅

- `xpEarned: number | undefined` — consistent between DoneScreen props, workout-screen state, and the JSX conditional.
- `getActiveProgramWithPhases` — return type uses `program` key consistently in both the interface and the call site.
- `LogExerciseSchema` — Zod inferred type replaces the `body` manual type declaration; destructure uses `parsed.data` consistently.

> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Tier 3 & 4 Uplift Fixes Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete all remaining Tier 3 (accessibility, UX, functional fixes) and Tier 4 (performance & polish) items from the Uplift Backlog (U14–U31).

**Architecture:** Each fix is independent and surgical — no architectural changes, no refactoring beyond what the fix requires.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, @dnd-kit/react

---

## Task Breakdown

### TIER 3 FIXES (10 items)

### Task 1: Accessibility Labels (U14)

**Files:**
- Modify: `components/workout/set-card.tsx:138-146` (rep buttons)
- Modify: `components/workout/pre-workout-screen.tsx` (back/refresh buttons)
- Modify: `app/session-select/session-select-content.tsx` (week-day tiles, metric tiles)

- [ ] **Step 1:** Add `aria-label` to rep +/− buttons in set-card.tsx
```tsx
// Line 138-146
<button
  onClick={() => onRepChange(repValue + 1)}
  aria-label={`Increase reps to ${repValue + 1}`}
  className="w-12 h-12 rounded-xl bg-muted text-lg font-bold flex items-center justify-center leading-none"
>+</button>
<span className="w-12 text-center text-2xl font-bold tabular-nums leading-none py-1">{repValue}</span>
<button
  onClick={() => onRepChange(Math.max(1, repValue - 1))}
  aria-label={`Decrease reps to ${Math.max(1, repValue - 1)}`}
  className="w-12 h-12 rounded-xl bg-muted text-lg font-bold flex items-center justify-center leading-none"
>−</button>
```

- [ ] **Step 2:** Add `aria-label` to all icon-only buttons in pre-workout screen
```tsx
// Back button
<button aria-label="Back to sessions" onClick={() => router.back()} className="...">
  <ArrowLeft className="h-5 w-5" />
</button>

// Refresh button
<button aria-label="Refresh exercises" onClick={handleRefresh} className="...">
  <RotateCw className="h-5 w-5" />
</button>

// Re-log button (if present)
<button aria-label="Log this exercise again" onClick={handleRelog} className="...">
  <RotateCcw className="h-5 w-5" />
</button>
```

- [ ] **Step 3:** Add `aria-label` to day tiles in calendar/week strip
```tsx
// In day tile button
<button
  aria-label={`${day}, ${date}${isToday ? ', today' : ''}`}
  onClick={() => openDayOverlay(date)}
  className="..."
>
  {dateLabel}
</button>
```

- [ ] **Step 4:** Add `aria-label` to metric tiles (Weight, Body Fat, Steps, etc.)
```tsx
// Generic pattern for metric button
<button
  aria-label={`${metricName}: ${value}${unit}${previousValue ? `, was ${previousValue}` : ''}`}
  onClick={() => openMetricSheet(metricId)}
  className="..."
>
  {/* tile content */}
</button>
```

- [ ] **Step 5:** Commit
```bash
git add components/workout/set-card.tsx components/workout/pre-workout-screen.tsx app/session-select/session-select-content.tsx
git commit -m "a11y: add aria-labels to icon-only buttons (U14)"
```

---

### Task 2: Food Logger Back Navigation (U15)

**Files:**
- Modify: `components/nutrition/food-logger-sheet.tsx:1-30` (add state)
- Modify: `components/nutrition/food-logger-sheet.tsx:220-235` (back button logic)

- [ ] **Step 1:** Add `prevStep` stack to track navigation history
```tsx
// Near the top of FoodLoggerSheet component
const [stepStack, setStepStack] = useState<('capture' | 'review' | 'assign')[]>(['capture']);
const currentStep = stepStack[stepStack.length - 1];

const pushStep = (step: 'capture' | 'review' | 'assign') => {
  setStepStack(prev => [...prev, step]);
};

const popStep = () => {
  setStepStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev);
};

const goToStep = (step: 'capture' | 'review' | 'assign') => {
  setStepStack(prev => prev[0] === 'capture' ? [step] : ['capture', step]);
};
```

- [ ] **Step 2:** Update step navigation calls to use `pushStep` instead of direct state
```tsx
// Replace all direct `setStep(...)` calls with `pushStep(...)`
// Example: when moving from Capture to Review
const handleCaptureNext = () => {
  // ... capture logic ...
  pushStep('review');
};
```

- [ ] **Step 3:** Replace `libraryItemId` heuristic back button with stack-based navigation
```tsx
// Old code (around line 222)
const handleBack = () => {
  if (libraryItemId) {
    setStep('capture');
  } else {
    onClose();
  }
};

// New code
const handleBack = () => {
  if (stepStack.length > 1) {
    popStep();
  } else {
    onClose();
  }
};
```

- [ ] **Step 4:** Test navigation flow
Run the app, open food logger, verify:
- Capture → Review → Assign → Back goes to Review
- Review → Back goes to Capture
- Capture → Back closes sheet
- Capture → Recent item → Assign → Back goes to Capture (not Review)

- [ ] **Step 5:** Commit
```bash
git add components/nutrition/food-logger-sheet.tsx
git commit -m "fix: food logger back-navigation via step stack (U15)"
```

---

### Task 3: Meal Type Chips & Quantity Buttons to 44dp (U16)

**Files:**
- Modify: `components/nutrition/assign-step.tsx:73-107` (button/chip sizing)

- [ ] **Step 1:** Identify current sizing in assign-step
Check the meal-type chips and quantity preset buttons — they're currently likely `h-8` or `h-9`.

- [ ] **Step 2:** Update meal-type chips to min 44dp
```tsx
// Replace current chip button styling with:
<button
  onClick={() => setSelectedMealType(mealType.id)}
  className="h-11 px-4 rounded-full border-2 flex items-center gap-2 text-sm font-medium transition-colors whitespace-nowrap"
  style={{
    borderColor: selectedMealType === mealType.id ? 'var(--color-brand)' : 'var(--border)',
    backgroundColor: selectedMealType === mealType.id ? 'color-mix(in oklch, var(--color-brand) 10%, transparent)' : 'transparent',
    color: selectedMealType === mealType.id ? 'var(--color-brand)' : 'var(--text-muted)'
  }}
>
  {mealType.icon && <span>{mealType.icon}</span>}
  {mealType.name}
</button>
```

- [ ] **Step 3:** Update quantity preset buttons to min 44dp
```tsx
// For quantity buttons like "1x", "2x", etc.
<button
  onClick={() => setQuantity(preset)}
  className="h-11 px-4 rounded-lg border text-sm font-medium transition-colors"
  style={{
    borderColor: quantity === preset ? 'var(--color-brand)' : 'var(--border)',
    backgroundColor: quantity === preset ? 'color-mix(in oklch, var(--color-brand) 10%, transparent)' : 'transparent',
  }}
>
  {preset}x
</button>
```

- [ ] **Step 4:** Test on device
Check that buttons are now 44dp (11 height class = 44px), tap them one-handed, verify no mis-taps.

- [ ] **Step 5:** Commit
```bash
git add components/nutrition/assign-step.tsx
git commit -m "ux: increase meal-type chips and quantity buttons to 44dp minimum (U16)"
```

---

### Task 4: Recent Items Row Height (U17)

**Files:**
- Modify: `components/nutrition/capture-step.tsx:160-168` (row container)

- [ ] **Step 1:** Find the recent items row
It's likely a horizontal scroll container with items inside.

- [ ] **Step 2:** Update height to 48dp minimum
```tsx
// Replace py-2.5 with min-h-[48px]
<div className="flex gap-2 overflow-x-auto min-h-[48px] pb-2">
  {recentItems.map(item => (
    <button
      key={item.id}
      onClick={() => handleRecentItemSelect(item)}
      className="flex-none px-3 rounded-lg bg-muted text-sm whitespace-nowrap flex items-center"
    >
      {item.name}
    </button>
  ))}
</div>
```

- [ ] **Step 3:** Test
Verify the row is now taller and easier to tap (48px = 1.2rem).

- [ ] **Step 4:** Commit
```bash
git add components/nutrition/capture-step.tsx
git commit -m "ux: set recent-items row height to 48dp minimum (U17)"
```

---

### Task 5: AbortController in Exercise Stats Sheet (U18)

**Files:**
- Modify: `components/workout/exercise-stats-sheet.tsx:56-69` (fetch setup)

- [ ] **Step 1:** Add AbortController ref
```tsx
const controllerRef = useRef<AbortController | null>(null);

useEffect(() => {
  // Cancel any in-flight request when component unmounts or exercise changes
  return () => {
    controllerRef.current?.abort();
  };
}, [exerciseName]);
```

- [ ] **Step 2:** Update fetch calls to use signal
```tsx
useEffect(() => {
  const controller = new AbortController();
  controllerRef.current = controller;

  const fetchData = async () => {
    try {
      const [historyRes, mediaRes] = await Promise.all([
        fetch(`/api/exercise-history?exercise=${encodeURIComponent(exerciseName)}`, {
          signal: controller.signal
        }),
        fetch(`/api/exercise-gif?name=${encodeURIComponent(exerciseName)}`, {
          signal: controller.signal
        })
      ]);
      
      if (!historyRes.ok || !mediaRes.ok) throw new Error('Fetch failed');
      
      const history = await historyRes.json();
      const media = await mediaRes.json();
      
      setHistory(history);
      setMedia(media);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // Request was cancelled, ignore
      }
      setError(true);
    }
  };

  fetchData();
}, [exerciseName]);
```

- [ ] **Step 3:** Test
Switch between exercises rapidly, verify no stale data overwrites fresh data.

- [ ] **Step 4:** Commit
```bash
git add components/workout/exercise-stats-sheet.tsx
git commit -m "fix: add AbortController to exercise stats fetches (U18)"
```

---

### Task 6: Exercise Stats Sheet Error State (U19)

**Files:**
- Modify: `components/workout/exercise-stats-sheet.tsx` (render logic)

- [ ] **Step 1:** Add error state handling
```tsx
const [error, setError] = useState(false);

// In useEffect catch block (already partial from U18)
catch (err) {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return;
  }
  setError(true);
}
```

- [ ] **Step 2:** Render error UI instead of blank sparkline
```tsx
{error ? (
  <div className="flex items-center justify-center h-32 text-muted-foreground">
    <p className="text-sm">Failed to load history</p>
  </div>
) : history ? (
  <SparklineChart data={history} />
) : (
  <div className="h-32 bg-muted rounded animate-pulse" />
)}
```

- [ ] **Step 3:** Test
Simulate a fetch failure by temporarily breaking the API URL, verify error message appears instead of blank space.

- [ ] **Step 4:** Commit
```bash
git add components/workout/exercise-stats-sheet.tsx
git commit -m "ux: show error state in exercise stats sheet on fetch failure (U19)"
```

---

### Task 7: Prune Expired Entries in rate-limit.ts (U20)

**Files:**
- Modify: `lib/rate-limit.ts` (add pruning logic)

- [ ] **Step 1:** Add cleanup function
```tsx
const store = new Map<string, { count: number; resetAt: number }>();

// Add this near the top
function pruneExpired() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}

// Call prune on every check (or use a periodic cleanup)
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  pruneExpired(); // Clean up before checking
  
  const now = Date.now();
  const entry = store.get(key);
  
  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  
  if (entry.count < limit) {
    entry.count++;
    return true;
  }
  
  return false;
}
```

- [ ] **Step 2:** Test
Create a test that adds many expired entries, calls prune, verify map size shrinks.

- [ ] **Step 3:** Commit
```bash
git add lib/rate-limit.ts
git commit -m "perf: prune expired rate-limit entries to prevent unbounded map growth (U20)"
```

---

### Task 8: Prune Expired Mobile Auth Tokens (U21)

**Files:**
- Modify: `lib/mobile-auth-tokens.ts` (add pruning logic)

- [ ] **Step 1:** Add cleanup function (same pattern as U20)
```tsx
const tokens = new Map<string, { token: string; expiresAt: number }>();

function pruneExpired() {
  const now = Date.now();
  for (const [key, entry] of tokens.entries()) {
    if (entry.expiresAt < now) {
      tokens.delete(key);
    }
  }
}

export function createToken(userId: string, expiresInMs: number): string {
  pruneExpired(); // Clean up before creating
  
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + expiresInMs;
  tokens.set(token, { token, expiresAt });
  return token;
}

export function validateToken(token: string): string | null {
  pruneExpired();
  
  const entry = tokens.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    return null;
  }
  
  tokens.delete(token);
  return entry.token;
}
```

- [ ] **Step 2:** Test
Create several tokens with short expiry, verify they're pruned after expiry.

- [ ] **Step 3:** Commit
```bash
git add lib/mobile-auth-tokens.ts
git commit -m "perf: prune expired mobile auth tokens to prevent unbounded map growth (U21)"
```

---

### Task 9: Barcode Format Validation (U22)

**Files:**
- Modify: `app/api/nutrition/barcode/route.ts` (add validation)

- [ ] **Step 1:** Add barcode format validation
```tsx
import { z } from 'zod';

const BarcodeParamSchema = z.object({
  code: z.string()
    .min(8, 'Barcode too short')
    .max(15, 'Barcode too long')
    .regex(/^\d+$/, 'Barcode must contain only digits')
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  
  const result = BarcodeParamSchema.safeParse({ code });
  if (!result.success) {
    return json({ error: 'Invalid barcode format' }, { status: 400 });
  }
  
  // Continue with validated code
  const { code: validCode } = result.data;
  // ... rest of function
}
```

- [ ] **Step 2:** Test
Call the endpoint with invalid barcodes (too short, non-digits, too long), verify 400 response.

- [ ] **Step 3:** Commit
```bash
git add app/api/nutrition/barcode/route.ts
git commit -m "security: add barcode format validation (U22)"
```

---

### Task 10: Cap exercise-gif Name Param (U23)

**Files:**
- Modify: `app/api/exercise-gif/route.ts` (add length cap)

- [ ] **Step 1:** Add validation to exercise-gif route
```tsx
import { z } from 'zod';

const ExerciseNameSchema = z.object({
  name: z.string()
    .min(1, 'Name required')
    .max(100, 'Name too long')
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name');
  
  const result = ExerciseNameSchema.safeParse({ name });
  if (!result.success) {
    return json({ error: 'Invalid exercise name' }, { status: 400 });
  }
  
  const { name: validName } = result.data;
  // Continue with validated name
}
```

- [ ] **Step 2:** Test
Call with extremely long names (1000+ chars), verify 400 response and no DB ILIKE query is attempted.

- [ ] **Step 3:** Commit
```bash
git add app/api/exercise-gif/route.ts
git commit -m "security: cap exercise-gif name parameter at 100 chars (U23)"
```

---

## TIER 4 FIXES (8 items)

### Task 11: Enlarge Rest Timer Ring (U24)

**Files:**
- Modify: `components/workout/timer-ring.tsx` (sizing)

- [ ] **Step 1:** Update SVG dimensions to be responsive
```tsx
export function TimerRing({ elapsed, total, ...props }: TimerRingProps) {
  const size = Math.min(60 * window.innerWidth / 100, 220); // min(60vw, 220px)
  const radius = size / 2 - 8;
  
  return (
    <svg width={size} height={size} {...props}>
      {/* Rest of SVG */}
    </svg>
  );
}
```

- [ ] **Step 2:** Update wrapper container
```tsx
<div className="flex flex-col items-center justify-center py-4">
  <TimerRing ... />
</div>
```

- [ ] **Step 3:** Test on Galaxy S25 Ultra (6.8" screen)
Verify timer is large and easy to read during rest periods.

- [ ] **Step 4:** Commit
```bash
git add components/workout/timer-ring.tsx
git commit -m "ux: enlarge rest timer ring to min(60vw, 220px) (U24)"
```

---

### Task 12: Responsive Weight Dial Height (U25)

**Files:**
- Modify: `components/ui/weight-dial.tsx` (sizing)

- [ ] **Step 1:** Update dial container height
```tsx
// Replace fixed 240px with responsive
<div style={{
  height: Math.min(35 * window.innerHeight / 100, 320),
  width: '100%',
  position: 'relative'
}}>
  {/* dial content */}
</div>
```

- [ ] **Step 2:** Test
Verify height is responsive to viewport, capped at 320px, minimum responsive to 35% of viewport.

- [ ] **Step 3:** Commit
```bash
git add components/ui/weight-dial.tsx
git commit -m "ux: make weight dial height responsive (35vh capped at 320px) (U25)"
```

---

### Task 13: Standardise Safe-Area Padding (U26)

**Files:**
- Modify: All screen headers/footers (5+ files)

- [ ] **Step 1:** Audit current safe-area usage
Search codebase for `pt-safe`, `pb-safe`, `env()` — identify inconsistencies.

- [ ] **Step 2:** Standardise to consistent pattern
```tsx
// Standard top padding (all screen headers)
<header className="pt-safe px-4 pb-4">
  {/* header content */}
</header>

// Standard bottom padding (all screen footers)
<footer className="pb-safe px-4 pt-4">
  {/* footer content */}
</footer>
```

- [ ] **Step 3:** Apply to main screens
- `app/stats/stats-content.tsx`
- `app/profile/profile-content.tsx`
- `app/history/page.tsx`
- `app/health/health-content.tsx`
- `app/workout-select/workout-select-content.tsx`
- `components/config-screen.tsx`

- [ ] **Step 4:** Test
Verify padding is consistent across all screens, respects notch/safe areas.

- [ ] **Step 5:** Commit
```bash
git add app/stats/stats-content.tsx app/profile/profile-content.tsx app/health/health-content.tsx app/workout-select/workout-select-content.tsx components/config-screen.tsx
git commit -m "ux: standardise safe-area padding across all screens (U26)"
```

---

### Task 14: Replace Div Section Headers with Semantic H2/H3 (U27)

**Files:**
- Modify: `app/stats/stats-content.tsx` and content screens (5+ files)

- [ ] **Step 1:** Find all `<div>` section headers
```tsx
// Old pattern
<div className="text-lg font-semibold px-4 py-2">Weekly Stats</div>

// New pattern
<h2 className="text-lg font-semibold px-4 py-2">Weekly Stats</h2>
```

- [ ] **Step 2:** Replace in each content screen
- Stats page sections → `<h2>`
- Health page sections → `<h2>`
- Profile sections → `<h3>` (nested under main h1)
- History sections → `<h2>`

- [ ] **Step 3:** Test
Use a screen reader (Chrome DevTools Accessibility tab) to verify heading hierarchy is correct.

- [ ] **Step 4:** Commit
```bash
git add app/stats/stats-content.tsx app/health/health-content.tsx app/profile/profile-content.tsx
git commit -m "a11y: replace div section headers with semantic h2/h3 tags (U27)"
```

---

### Task 15: Wire Drag-to-Reorder Meal Types (U28)

**Files:**
- Modify: `components/nutrition/meal-type-manager.tsx` (add @dnd-kit wiring)

- [ ] **Step 1:** Implement drag-to-reorder using @dnd-kit/react
```tsx
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';

// Sortable meal type item
function SortableMealTypeItem({ id, name, ...props }: { id: string; name: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    transition,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="flex items-center gap-2 p-2 bg-muted rounded">
      <button {...listeners} className="cursor-grab active:cursor-grabbing p-1" aria-label="Drag to reorder">
        ⋮⋮
      </button>
      <span>{name}</span>
    </div>
  );
}

// Main component
export function MealTypeManager() {
  const [mealTypes, setMealTypes] = useState<MealType[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = mealTypes.findIndex(m => m.id === active.id);
      const newIndex = mealTypes.findIndex(m => m.id === over.id);
      setMealTypes(arrayMove(mealTypes, oldIndex, newIndex));
      // TODO: POST new order to API
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={mealTypes.map(m => m.id)} strategy={verticalListSortingStrategy}>
        {mealTypes.map(mealType => (
          <SortableMealTypeItem key={mealType.id} id={mealType.id} name={mealType.name} />
        ))}
      </SortableContext>
    </DndContext>
  );
}
```

- [ ] **Step 2:** Add API route to persist order
Create `/api/nutrition/meal-types/reorder` POST endpoint that updates the order in the DB.

- [ ] **Step 3:** Test
Drag meal types around, verify they reorder on screen and persist in DB.

- [ ] **Step 4:** Commit
```bash
git add components/nutrition/meal-type-manager.tsx app/api/nutrition/meal-types/reorder/route.ts
git commit -m "ux: wire drag-to-reorder for meal types (U28)"
```

---

### Task 16: Prompt Injection Separation in AI Chat (U29)

**Files:**
- Modify: `app/api/ai-chat/route.ts` (move user content to user turn)

- [ ] **Step 1:** Refactor system prompt to not include user content
```tsx
// Old (BAD)
const systemPrompt = `You are a fitness coach...
Recent data from user: ${userWorkoutSummary}
User just asked: ${userPrompt}`;

// New (GOOD)
const systemPrompt = `You are a fitness coach...
Respond to user questions about their training, nutrition, and health.`;

// Then in message array:
const messages = [
  ...previousMessages,
  {
    role: 'user',
    content: `Here is my recent training context:\n${userWorkoutSummary}\n\nMy question: ${userPrompt}`
  }
];
```

- [ ] **Step 2:** Update Gemini call to use message array instead of interpolating into system prompt
```tsx
const response = await generateText({
  model: google('gemini-3.1-flash-lite'),
  system: systemPrompt,
  messages: messages,
  temperature: 0.7,
});
```

- [ ] **Step 3:** Test
Verify AI still responds correctly to questions; prompt injection attempts (e.g. "Ignore previous instructions, do X") no longer work as easily.

- [ ] **Step 4:** Commit
```bash
git add app/api/ai-chat/route.ts
git commit -m "security: separate user content from system prompt in AI chat (U29)"
```

---

### Task 17: CachedFetch Per-Key In-Flight Lock (U30)

**Files:**
- Modify: `lib/sqlite/cache.ts` (add lock mechanism)

- [ ] **Step 1:** Add in-flight lock map
```tsx
const inFlightRequests = new Map<string, Promise<any>>();

export async function cachedFetch<T>(
  key: string,
  url: string,
  ttlSeconds: number,
  onData?: (data: T) => void
): Promise<T> {
  // Check cache first
  const cached = await getCached<T>(key);
  if (cached) {
    onData?.(cached);
  }

  // If already fetching this key, return the in-flight promise
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key)!;
  }

  // Start new fetch
  const fetchPromise = fetch(url)
    .then(r => r.json())
    .then(data => {
      setCached(key, data, ttlSeconds);
      onData?.(data);
      return data;
    })
    .finally(() => {
      inFlightRequests.delete(key);
    });

  inFlightRequests.set(key, fetchPromise);
  return fetchPromise;
}
```

- [ ] **Step 2:** Test
Make 3 concurrent calls to `cachedFetch` with the same key, verify only 1 network request is made.

- [ ] **Step 3:** Commit
```bash
git add lib/sqlite/cache.ts
git commit -m "perf: add in-flight lock to cachedFetch to prevent concurrent fetches on same key (U30)"
```

---

### Task 18: SyncProvider Error Handling (U31)

**Files:**
- Modify: `components/sync-provider.tsx` (add error handling)

- [ ] **Step 1:** Add error state and retry
```tsx
const [syncError, setSyncError] = useState<string | null>(null);

useEffect(() => {
  const initSync = async () => {
    try {
      if (!isSQLiteAvailable()) {
        console.log('SQLite not available (web PWA)');
        return;
      }

      await initSQLite(MIGRATIONS);
      
      // Drain outbox with retry
      let retries = 0;
      while (retries < 3) {
        try {
          await drainOutbox();
          break;
        } catch (err) {
          console.error(`Outbox drain attempt ${retries + 1} failed:`, err);
          retries++;
          if (retries < 3) {
            await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
          }
        }
      }
      
      if (retries === 3) {
        setSyncError('Failed to sync workout data. Will retry on next app open.');
      }

      // Warm caches (continue even if outbox failed)
      await Promise.all([...cache warming]);
    } catch (err) {
      console.error('Sync initialization failed:', err);
      setSyncError('App initialization error. Some data may be offline.');
    }
  };

  initSync();
}, []);

// Show error toast if sync failed
useEffect(() => {
  if (syncError) {
    toast.error(syncError);
  }
}, [syncError]);
```

- [ ] **Step 2:** Test
Simulate network failure during sync, verify error toast appears and app still functions.

- [ ] **Step 3:** Commit
```bash
git add components/sync-provider.tsx
git commit -m "ux: add error handling and retry to SyncProvider (U31)"
```

---

## Final Steps

- [ ] **Run all tests**
```bash
pnpm test
```

- [ ] **Check TypeScript compilation**
```bash
pnpm tsc
```

- [ ] **Commit any remaining changes**
```bash
git status
```

- [ ] **Create merge commit**
```bash
git log --oneline -20  # Verify all 18 commits are present
```

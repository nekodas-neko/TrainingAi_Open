# Safe-Area System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permanently end the recurring "bottom button hidden behind the gesture bar / bottom nav" class of bug (workout screens, the Oura health detail screens, bottom sheets) by moving safe-area handling out of individual screens and into shared primitives + a CI rule, with an optional native inset bridge for bulletproof values.

**Architecture — why this bug keeps recurring and what actually fixes it:** the CSS plumbing already works (`viewportFit: "cover"` is set in `app/layout.tsx:75-78`; `.pb-safe`/`.pt-safe` utilities exist in `app/globals.css:297-316`) — but **48 files hand-roll `env(safe-area-inset-bottom)` individually**, so every new screen must remember to add it and the ones that forget ship broken. The fix is three layers: (1) safe padding applied **inside the shared primitives** (`SheetContent side="bottom"`, `SheetFooter`, a new `<BottomActionBar>`) so consumers get it for free; (2) a **CI custom rule** that fails any new hand-rolled usage outside the sanctioned files; (3) optionally, a **native WindowInsets bridge** that publishes the OS's real inset values as CSS variables — the "formula that adapts to the device" — for Android WebView configurations where `env()` reports 0.

**Tech Stack:** Tailwind v4 + CSS `env()`, Radix Sheet (`components/ui/sheet.tsx`), the grep-based Custom Rules CI job (`.github/workflows/*.yml:92+`), Capacitor Android (`android/` is in-repo; MainActivity already hosts a JS bridge — the `window.AndroidMotion` pattern from v1.74.3).

**Two distinct clearances — don't conflate them (this confusion caused past regressions):**
- **Gesture-bar clearance:** fixed/sticky bottom UI needs `padding-bottom: max(env(safe-area-inset-bottom), 0.75rem)` so its buttons sit above the Android gesture bar.
- **Bottom-nav clearance:** scrollable page content needs `padding-bottom: calc(3.5rem + env(safe-area-inset-bottom))` (`3.5rem` = the nav's `h-14` at `bottom-nav.tsx:53`) so the last item can scroll clear of the fixed nav. Screens *without* the nav (full-screen workout flow, sheets) must NOT get this larger clearance.

---

## Task 1: Canonical utilities

**Files:**
- Modify: `app/globals.css:297-316` (extend the existing safe-area block)

- [ ] **Step 1:** Add two utilities beside the existing `.pb-safe`/`.pt-safe`:

```css
  /* Fixed/sticky bottom action bars & sheet footers: clear the gesture bar,
     with a comfortable floor when there is no inset (3-button nav / desktop). */
  .pb-safe-action {
    padding-bottom: max(env(safe-area-inset-bottom, 0px), 0.75rem);
  }
  /* Scrollable page content on screens WITH the bottom nav: clear nav + inset.
     3.5rem = the nav's h-14. Do not use on navless screens or sheets. */
  .pb-nav-safe {
    padding-bottom: calc(3.5rem + env(safe-area-inset-bottom, 0px));
  }
```

- [ ] **Step 2:** `pnpm lint` passes. Commit:

```bash
git add app/globals.css
git commit -m "Add canonical bottom safe-area utilities"
```

## Task 2: Fix the primitives — every bottom sheet at once

Most bottom CTAs live in Radix Sheet footers; patching the primitive fixes the whole class in one edit.

**Files:**
- Modify: `components/ui/sheet.tsx` (~line 70 `side === "bottom"` styles; line 98 `SheetFooter`)

- [ ] **Step 1:** In the `side === "bottom"` class string (~line 70), append `pb-safe-action` so every bottom sheet clears the gesture bar even when a consumer forgets.
- [ ] **Step 2:** In `SheetFooter` (line 98), add `pb-safe-action` to its base classes.
- [ ] **Step 3:** Sweep consumers that now double-pad: `grep -rn "safe-area-inset-bottom" components app --include='*.tsx' | grep -i "sheet"` — remove each consumer-level `pb-[env(safe-area-inset-bottom)]`/inline equivalent inside sheet content/footers (the primitive owns it now). The metric-log sheet's `SheetFooter className="… pb-[env(safe-area-inset-bottom)]"` at `app/health/health-content.tsx:880` is one known instance.
- [ ] **Step 4: Verify** (`pnpm dev`, S25 viewport ~412×915 with devtools device emulation): open the metric-log sheet, the End of Day sheet, add-exercise sheet, water-log sheet — footers sit clear of the bottom edge with no doubled gap.
- [ ] **Step 5: Commit**

```bash
git add components/ui/sheet.tsx app components
git commit -m "Bottom sheets own their safe-area padding at the primitive level"
```

## Task 3: `<BottomActionBar>` for non-sheet bottom CTAs

**Files:**
- Create: `components/ui/bottom-action-bar.tsx`
- Modify: the fixed-bottom CTA screens (enumerated in Step 2)

- [ ] **Step 1: Create the component**

```tsx
import { cn } from "@/lib/utils";

interface BottomActionBarProps {
  children: React.ReactNode;
  /** true when the bottom nav is visible on this screen (adds nav clearance). */
  aboveNav?: boolean;
  className?: string;
}

/** Fixed bottom container for primary actions. Owns gesture-bar clearance. */
export function BottomActionBar({ children, aboveNav = false, className }: BottomActionBarProps) {
  return (
    <div
      className={cn(
        "fixed left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-t border-border/60 px-4 pt-3",
        aboveNav ? "bottom-14 pb-3" : "bottom-0 pb-safe-action",
        className,
      )}
    >
      {children}
    </div>
  );
}
```

(When `aboveNav`, the nav itself already carries `pb-[env(safe-area-inset-bottom)]` — `bottom-nav.tsx:52` — so the bar needs only to sit on top of the nav's `h-14`.)

- [ ] **Step 2: Enumerate the offenders**

```bash
grep -rn "fixed bottom-0" app components --include='*.tsx' | grep -v bottom-nav | grep -v bottom-action-bar
```

Migrate each fixed-bottom CTA container onto `<BottomActionBar>`, prioritising the user-reported screens: the workout flow's accept/select/log buttons (`components/workout/pre-workout-screen.tsx`, `active-workout-screen.tsx`, `exercise-summary-screen.tsx`, `done-screen.tsx`) and the Oura health detail pages (`app/health/{sleep,readiness,activity,heart-rate}/*-content.tsx`). Where a screen's scroll content now hides behind the bar, give the scroll container `pb-nav-safe` (nav screens) or bottom padding equal to the bar height (navless screens).
- [ ] **Step 3: Verify each migrated screen** at the S25 viewport: button fully visible and tappable; last scroll item reachable; no double gap. Then on-device (final checklist) — gesture nav AND 3-button nav (Android Settings → System → Navigation mode) since the inset differs.
- [ ] **Step 4: Commit**

```bash
git add components app
git commit -m "Route fixed bottom actions through BottomActionBar"
```

## Task 4: Migrate the remaining hand-rolled sites

**Files:**
- Modify: the remainder of the 48 files using raw `env(safe-area-inset-bottom)`

- [ ] **Step 1:** `grep -rln "safe-area-inset-bottom" app components --include='*.tsx'` — after Tasks 2–3 the list should be much shorter. Replace each remaining raw usage with the matching utility: `.pb-safe-action` (bars/footers), `.pb-nav-safe` (scroll content under the nav), `.pb-safe` (plain inset, no floor). The only sanctioned raw usages left: `bottom-nav.tsx` itself and `globals.css`.
- [ ] **Step 2:** `npx tsc --noEmit && pnpm lint`; spot-check three migrated screens. Commit:

```bash
git add app components
git commit -m "Replace hand-rolled safe-area padding with the shared utilities"
```

## Task 5: CI custom rule — make the fix permanent

**Files:**
- Modify: `.github/workflows/<ci file>` (the `custom-rules` job at line ~92; follow the exact pattern of the existing "No UTC date slicing" step)

- [ ] **Step 1:** Add a step after the existing custom rules:

```yaml
      - name: No hand-rolled safe-area insets
        run: |
          FOUND=$(grep -rn --include='*.tsx' 'safe-area-inset' \
            app/ components/ 2>/dev/null \
            | grep -v 'components/shell/bottom-nav.tsx' || true)
          if [ -n "$FOUND" ]; then
            echo "Safe-area violation — use pb-safe-action / pb-nav-safe / pb-safe from globals.css (or SheetFooter/BottomActionBar which own it):"
            echo "$FOUND"
            exit 1
          fi
```

- [ ] **Step 2:** Run the grep locally — it must return empty after Task 4, so CI is green on this PR itself.
- [ ] **Step 3: Commit**

```bash
git add .github
git commit -m "CI rule: safe-area insets only via the shared utilities"
```

## Task 6 (Phase 2, optional — needs an APK rebuild): native inset bridge

`env(safe-area-inset-bottom)` in an Android WebView is only populated when the activity draws edge-to-edge; if any future Android/WebView change zeroes it (a known WebView variance), every fix above silently degrades to the `0.75rem` floor. This task makes the values bulletproof by reading them from the OS — the "function that returns the device's real safe spacing".

**Files:**
- Modify: `android/app/src/main/java/**/MainActivity.java` (same bridge pattern as the existing `window.AndroidMotion` from v1.74.3), `app/globals.css`

- [ ] **Step 1:** In `MainActivity`, attach an inset listener after bridge init and publish the values as CSS variables:

```java
ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (v, insets) -> {
    Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
    float density = getResources().getDisplayMetrics().density;
    final String js = String.format(java.util.Locale.US,
        "document.documentElement.style.setProperty('--android-inset-top','%.0fpx');" +
        "document.documentElement.style.setProperty('--android-inset-bottom','%.0fpx');",
        bars.top / density, bars.bottom / density);
    runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(js, null));
    return insets;
});
```

- [ ] **Step 2:** Make the CSS utilities prefer the bridge value with `env()` as fallback, e.g. `.pb-safe-action { padding-bottom: max(var(--android-inset-bottom, env(safe-area-inset-bottom, 0px)), 0.75rem); }` (apply the same pattern to `.pb-safe`, `.pb-nav-safe`, and the two `pt-safe` utilities with `--android-inset-top`).
- [ ] **Step 3:** Device verification (cannot test in sandbox): rebuild the APK, confirm the variables appear on `document.documentElement` (`adb` WebView devtools), rotate the device, toggle gesture vs 3-button nav, and confirm the bars track the real inset in all cases.
- [ ] **Step 4: Commit** (native change — flag in the PR that an APK rebuild is required for this task only; Tasks 1–5 deploy as WebView JS/CSS via Railway with no rebuild).

## Final checks

- [ ] `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build` green; the Task 5 grep returns empty.
- [ ] Emulated pass (S25 viewport): every screen with a bottom CTA — workout flow (all four modes), the four Oura detail pages, nutrition sheets, End of Day, config/builder.
- [ ] **On-device pass (required — this bug class only truly shows on the phone):** gesture nav and 3-button nav; the four Oura health screens the user specifically reported.
- [ ] PR (title: "Safe-area system: primitives own bottom insets + CI guard") — Tasks 1–5 deploy on merge; **ask the user before merging** (code change).

## Self-review

- Root cause addressed at the right altitude: primitives own the padding (Tasks 2–3), migration clears the debt (Task 4), CI prevents regression (Task 5), native bridge removes the env() dependency entirely (Task 6). ✔
- The two clearance types (gesture bar vs bottom nav) are distinguished everywhere, with the nav height tied to its actual `h-14`. ✔
- Interaction with Batch G noted: `ScreenHeader` (top contract) and this plan (bottom contract) together make safe-area fully primitive-owned; if Batch G's Task 12 has landed, headers are already compliant.
- Out of scope: iOS (no iOS build exists); keyboard-avoidance (separate concern — `env(keyboard-inset-height)` is not yet reliable in the WebView).

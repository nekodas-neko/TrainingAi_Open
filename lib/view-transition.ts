"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { tabKeyForHref } from "@/components/shell/tabs";

// Native-feeling screen transitions via the browser's View Transitions API.
//
// Why this API and not Framer Motion (which is already installed): a view
// transition is interpolated by the COMPOSITOR from before/after snapshots, so
// it never runs JS per frame. Samsung's WebView is the only supported target and
// its compositor is documented in CLAUDE.md as the thing that janks on
// JS-driven animation — so the cheapest-per-frame option is the right one here.
//
// Deliberately NOT applied to bottom-nav tab switches. Not because those should
// be motionless — they get a fade-through in globals.css — but because a tab flip
// is a shell state change, not a navigation: no route resolves, so there is
// nothing for a view transition to wait on and no hierarchy for it to express.
//
// The motion itself is Material 3's shared axis Y (vertical), not a horizontal
// push; see the keyframes in globals.css for why.

type ViewTransitionCapableDocument = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> };
};

// Hard cap on how long the outgoing screen may stay frozen waiting for the
// incoming route. This is a safety net for a navigation that never lands — NOT
// the normal path. The normal path is the commit poll below, which releases the
// frame as soon as the new route is actually in the DOM.
//
// Getting this wrong is what made the animation feel slow twice. It was first
// 1000 ms, then 150 ms — but both were the *only* path, because the early-resolve
// they were backstopping never ran (see the commit poll). So every navigation
// paid the full cap: measured 51 ms to route-commit against a 184 ms resolve,
// i.e. ~130 ms of frozen screen after the destination was ready.
const NAVIGATION_TIMEOUT_MS = 300;

// How often to check whether the navigation has committed.
//
// Deliberately a timer and not requestAnimationFrame: the browser suppresses
// frame production while a view-transition callback is pending, so a rAF loop
// would never tick and the poll would deadlock into the cap above.
const COMMIT_POLL_MS = 8;

// Navigating to where you already are never changes the URL, so the commit poll
// below would have nothing to detect and the screen would stay frozen for the
// full cap. Cheap to rule out, and it keeps the cap meaning "something went
// wrong" rather than "this was a no-op".
function isCurrentUrl(href: string): boolean {
  try { return new URL(href, location.href).href === location.href; }
  catch { return false; }
}

/** True when the browser can run a view transition and the user hasn't opted out of motion. */
export function canViewTransition(): boolean {
  if (typeof document === "undefined") return false;
  if (typeof (document as ViewTransitionCapableDocument).startViewTransition !== "function") return false;
  // A transition is motion; honour the OS-level preference the same way globals.css does.
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Drop-in replacement for `useRouter()` whose `push`/`replace`/`back` animate.
 *
 * Same call signature as Next's router, so a call site only changes which hook
 * it imports.
 */
export function useTransitionRouter() {
  const router = useRouter();

  const animate = useCallback((navigate: () => void, direction: "forward" | "back") => {
    if (!canViewTransition()) { navigate(); return; }

    // Drives which keyframe pair globals.css applies, so a back navigation
    // slides the opposite way like a native pop.
    document.documentElement.dataset.viewTransition = direction;
    const doc = document as ViewTransitionCapableDocument;

    // The subtlety that makes this work at all: `router.push` only *starts* a
    // navigation. startViewTransition takes its "after" snapshot the moment the
    // callback settles, so a callback that merely calls push() snapshots the OLD
    // page as the new one — giving no transition, or a flash of the wrong screen.
    // So the callback stays pending until the navigation has actually committed.
    //
    // That commit is detected from the URL, deliberately, rather than from a
    // React effect on usePathname(). The effect version could not work: the
    // resolver lived in a ref on the component that called push(), and that
    // component unmounts as the route changes, so the effect never re-ran and
    // every navigation fell through to the timeout cap.
    const transition = doc.startViewTransition!(() => new Promise<void>((resolve) => {
      const startHref = location.href;
      const deadline = performance.now() + NAVIGATION_TIMEOUT_MS;
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };

      const poll = () => {
        if (settled) return;
        // One extra macrotask after the URL flips: App Router updates history
        // during the commit, and this lets React's DOM mutation land before the
        // browser snapshots the "after" state.
        if (location.href !== startHref) { setTimeout(done, 0); return; }
        if (performance.now() >= deadline) { done(); return; }
        setTimeout(poll, COMMIT_POLL_MS);
      };

      navigate();
      poll();
    }));

    transition.finished
      .catch(() => { /* interrupted by a newer transition — not an error */ })
      .finally(() => { delete document.documentElement.dataset.viewTransition; });
  }, []);

  // A destination that resolves to one of the five bottom-nav tabs is a shell
  // flip, not a navigation — it must stay instant. tabKeyForHref already draws
  // this line (and already knows "/workout?session=…" is a real screen, not the
  // Workout tab), so the policy lives in one place rather than at 39 call sites.
  const push = useCallback((href: string) => {
    if (tabKeyForHref(href) || isCurrentUrl(href)) { router.push(href); return; }
    animate(() => router.push(href), "forward");
  }, [router, animate]);

  const replace = useCallback((href: string) => {
    if (tabKeyForHref(href) || isCurrentUrl(href)) { router.replace(href); return; }
    animate(() => router.replace(href), "forward");
  }, [router, animate]);

  const back = useCallback(() => {
    animate(() => router.back(), "back");
  }, [router, animate]);

  return useMemo(() => ({ ...router, push, replace, back }), [router, push, replace, back]);
}

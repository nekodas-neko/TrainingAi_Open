import type { useRouter } from "next/navigation";

type Router = ReturnType<typeof useRouter>;

/**
 * Navigate between the 5 main tabs. Deliberately a plain `router.push` with no
 * `document.startViewTransition` wrapper: tab screens seed synchronously from cache
 * (readCacheSync/readTodayCacheSync in a useLayoutEffect) and paint on the next frame,
 * so the directional View-Transition slide only animated stale content while gating that
 * instant paint by ~0.2s — pure perceived latency on the app's most frequent interaction
 * (UB2/UB3). The `fromPathname` arg is retained for call-site compatibility.
 */
export function navigateWithTransition(router: Router, _fromPathname: string, href: string): void {
  router.push(href);
}

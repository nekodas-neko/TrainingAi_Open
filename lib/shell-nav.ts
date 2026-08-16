export const TAB_NAV_EVENT = "ta:tab-navigate";

/**
 * Switch to another main tab. Handled by the mounted TabShell (instant,
 * client-side, no remount); falls back to a router navigation when no shell
 * is mounted (full-screen workout route, profile/admin pages).
 * `href` is a tab href, optionally with sub-tab params ("/health?tab=body") —
 * never the full-screen workout route ("/workout?session=…").
 */
export function navigateToTab(router: { push(href: string): void }, href: string): void {
  if (typeof window === "undefined") {
    router.push(href);
    return;
  }
  const unhandled = window.dispatchEvent(
    new CustomEvent<string>(TAB_NAV_EVENT, { detail: href, cancelable: true })
  );
  if (unhandled) router.push(href); // dispatchEvent returns false when the shell preventDefault()ed
}

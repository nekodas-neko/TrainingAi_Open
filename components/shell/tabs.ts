import { HomeIcon, DumbbellIcon, HeartIcon, UtensilsIcon, MoreHorizontalIcon } from "lucide-react";

export type TabKey = "home" | "health" | "workout" | "nutrition" | "more";

export const TABS = [
  { key: "home",      label: "Home",      icon: HomeIcon,           href: "/"          },
  { key: "health",    label: "Health",    icon: HeartIcon,          href: "/health"    },
  { key: "workout",   label: "Workout",   icon: DumbbellIcon,       href: "/workout"   },
  { key: "nutrition", label: "Nutrition", icon: UtensilsIcon,       href: "/nutrition" },
  { key: "more",      label: "More",      icon: MoreHorizontalIcon, href: "/more"      },
] as const;

export function hrefForTab(key: TabKey): string {
  return TABS.find((t) => t.key === key)!.href;
}

// Maps a tab href (optionally carrying query params, e.g. "/health?tab=body")
// to its tab key. Deliberately returns null for the full-screen workout route
// ("/workout?session=…") — that is a real navigation, never a shell flip.
export function tabKeyForHref(href: string): TabKey | null {
  const [path, query] = href.split("?");
  if (path === "/workout" && query?.includes("session=")) return null;
  const hit = TABS.find((t) => t.href === path);
  return hit ? hit.key : null;
}

export function activeTabIndex(pathname: string): number {
  if (pathname === "/") return 0;
  if (pathname.startsWith("/health")) return 1;
  if (pathname.startsWith("/workout")) return 2;
  if (pathname.startsWith("/nutrition")) return 3;
  if (pathname.startsWith("/more") || pathname.startsWith("/profile/")) return 4;
  return -1; // non-tab route: edge-swipe disabled
}

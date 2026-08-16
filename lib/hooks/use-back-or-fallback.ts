"use client";

import { useCallback } from "react";
import { useTransitionRouter } from "@/lib/view-transition";

// How deep history already was when this tab session started. Anything beyond it
// is an entry the app itself pushed, so `back()` is guaranteed to stay in-app.
//
// `history.length > 1` — the previous test — counts entries the app does not own
// (the WebView's initial entry, the sign-in redirect). Cold-starting straight
// onto a detail route reads length 2 and passes that test, so `back()` left the
// app entirely instead of falling back. sessionStorage, not a module variable,
// so the baseline survives a reload of the same tab.
const ENTRY_DEPTH_KEY = "ta-history-entry-depth";

function appOwnsPreviousEntry(): boolean {
  if (typeof window === "undefined") return false;
  let baseline = Number(sessionStorage.getItem(ENTRY_DEPTH_KEY));
  if (!baseline) {
    baseline = window.history.length;
    sessionStorage.setItem(ENTRY_DEPTH_KEY, String(baseline));
  }
  return window.history.length > baseline;
}

/**
 * Go back if the app owns the previous history entry, else replace with the fallback.
 *
 * Going back is the correct default even though these screens sit under /health:
 * the four detail routes are opened from the Home score circles *and* (for sleep
 * and heart-rate) from the Health screen's cards, so only history knows which one
 * the user actually came from. The fallback is for when there is no such history.
 *
 * Transition router, not the plain one: a screen you opened with an upward
 * shared-axis push has to close downward, or every detail screen animates open
 * and then cuts shut. `replace` to a tab href is still instant — the hook
 * already draws that line.
 */
export function useBackOrFallback(fallback: string) {
  const router = useTransitionRouter();
  return useCallback(() => {
    if (appOwnsPreviousEntry()) {
      router.back();
    } else {
      router.replace(fallback);
    }
  }, [router, fallback]);
}

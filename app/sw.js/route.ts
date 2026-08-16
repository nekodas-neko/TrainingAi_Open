import { readFileSync } from "fs";
import { join } from "path";
import { buildPrecacheList, renderServiceWorker } from "@/lib/sw/manifest";

// Serves the service worker from a template with the cache name build-stamped in
// (one cache name per deploy — no manual bump, forgotten twice historically) and
// a per-build precache manifest of every immutable _next/static asset injected,
// so the APK can cold-start and navigate offline. `public/sw-template.js` (not
// `public/sw.js`) so Next's static file serving never shadows this route.
const TEMPLATE_PATH = join(process.cwd(), "public", "sw-template.js");
const STATIC_DIR = join(process.cwd(), ".next", "static");
const BUILD_ID = process.env.RAILWAY_GIT_COMMIT_SHA ?? String(Date.now());

// BUILD_ID is constant for the process lifetime, so the (potentially large)
// static-dir walk runs once, not on every SW fetch.
let _cached: { buildId: string; body: string } | null = null;

export async function GET() {
  if (!_cached || _cached.buildId !== BUILD_ID) {
    const template = readFileSync(TEMPLATE_PATH, "utf-8");
    const body = renderServiceWorker(template, {
      cacheName: `ta-${BUILD_ID.slice(0, 12)}`,
      precacheUrls: buildPrecacheList(STATIC_DIR),
    });
    _cached = { buildId: BUILD_ID, body };
  }
  return new Response(_cached.body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Never let the browser cache this response — it must always re-check for a
      // new build id, or SW updates would never be detected.
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    },
  });
}

import { readdirSync, type Dirent } from 'fs'
import { join } from 'path'

// Recursively list every file under staticDir as a /_next/static/... URL. These
// are content-hashed and immutable, so precaching the full set per build is safe
// and is what makes lazy route chunks available offline (the "Loading chunk
// failed" dead-end). .map files are dev-only sourcemaps and never requested by
// the running app, so they are excluded to keep the precache lean.
export function listStaticAssets(staticDir: string): string[] {
  const urls: string[] = []
  function walk(dir: string, prefix: string): void {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // missing dir (dev / pre-build) — no static assets to precache
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else if (!entry.name.endsWith('.map')) urls.push(`/_next/static/${rel}`)
    }
  }
  walk(staticDir, '')
  return urls.sort()
}

// Always-precache entries beyond the static assets. Only the offline fallback
// document — the app icons are dynamic routes (app/icon.tsx), not static files,
// and the offline page uses an inline Lucide icon so it needs no network image.
export const EXTRA_PRECACHE_URLS = ['/offline']

export function buildPrecacheList(staticDir: string): string[] {
  return [...EXTRA_PRECACHE_URLS, ...listStaticAssets(staticDir)]
}

// Inject the build-stamped cache name and the precache manifest into the SW
// template. Each token appears exactly once in public/sw-template.js.
export function renderServiceWorker(
  template: string,
  opts: { cacheName: string; precacheUrls: string[] },
): string {
  return template
    .replace('__CACHE_NAME__', opts.cacheName)
    .replace('__PRECACHE_URLS__', JSON.stringify(opts.precacheUrls))
}

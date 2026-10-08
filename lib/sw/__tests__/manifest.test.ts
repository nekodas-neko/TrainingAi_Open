import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  listStaticAssets,
  buildPrecacheList,
  renderServiceWorker,
  EXTRA_PRECACHE_URLS,
} from '../manifest'

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sw-static-'))
  mkdirSync(join(dir, 'chunks'), { recursive: true })
  writeFileSync(join(dir, 'chunks', 'app.js'), '//app')
  writeFileSync(join(dir, 'chunks', 'app.js.map'), '{}')
  mkdirSync(join(dir, 'css'), { recursive: true })
  writeFileSync(join(dir, 'css', 'x.css'), 'a{}')
  return dir
}

describe('listStaticAssets', () => {
  it('lists files as /_next/static URLs and excludes .map', () => {
    const urls = listStaticAssets(fixtureDir())
    expect(urls).toContain('/_next/static/chunks/app.js')
    expect(urls).toContain('/_next/static/css/x.css')
    expect(urls).not.toContain('/_next/static/chunks/app.js.map')
  })
  it('returns [] for a missing dir (dev / no build)', () => {
    expect(listStaticAssets('/no/such/dir/xyz')).toEqual([])
  })
})

describe('buildPrecacheList', () => {
  it('prepends the extra URLs (offline page) to the static assets', () => {
    const list = buildPrecacheList(fixtureDir())
    for (const u of EXTRA_PRECACHE_URLS) expect(list).toContain(u)
    expect(list).toContain('/_next/static/css/x.css')
  })
})

describe('renderServiceWorker', () => {
  it('injects the cache name and a JSON-parseable precache manifest', () => {
    const template = 'const CACHE="__CACHE_NAME__"; const P=__PRECACHE_URLS__;'
    const body = renderServiceWorker(template, {
      cacheName: 'ta-abc123',
      precacheUrls: ['/offline', '/_next/static/css/x.css'],
    })
    expect(body).toContain('const CACHE="ta-abc123"')
    const m = body.match(/const P=(\[.*\]);/)!
    expect(JSON.parse(m[1])).toEqual(['/offline', '/_next/static/css/x.css'])
  })

  // #2608: `next dev` chunk names are reused while their contents change, so a cache-first worker
  // served the Dev app the first version of each chunk it ever saw. Production stays cache-first.
  it('is cache-first for _next/static by default and network-first only when told (next dev)', () => {
    const template = 'const S=__STATIC_CACHE_FIRST__;'
    expect(renderServiceWorker(template, { cacheName: 'c', precacheUrls: [] })).toBe('const S=true;')
    expect(renderServiceWorker(template, { cacheName: 'c', precacheUrls: [], staticCacheFirst: false })).toBe('const S=false;')
  })

  it('the template carries the token and branches on it inside the _next/static handler', () => {
    const sw = readFileSync(join(process.cwd(), 'public', 'sw-template.js'), 'utf8')
    expect(sw).toContain('const STATIC_CACHE_FIRST = __STATIC_CACHE_FIRST__;')
    const branch = sw.slice(sw.indexOf('url.pathname.startsWith("/_next/static/")'))
    expect(branch.indexOf('if (!STATIC_CACHE_FIRST)')).toBeGreaterThan(0)
    expect(branch.indexOf('if (!STATIC_CACHE_FIRST)')).toBeLessThan(branch.indexOf('caches.match(e.request)'))
  })

  it('the route turns cache-first off outside production', () => {
    const route = readFileSync(join(process.cwd(), 'app', 'sw.js', 'route.ts'), 'utf8')
    expect(route).toMatch(/staticCacheFirst:\s*process\.env\.NODE_ENV === "production"/)
  })
})

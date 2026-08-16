import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
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
})

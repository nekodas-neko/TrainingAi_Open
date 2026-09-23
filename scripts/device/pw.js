'use strict';
//
// Playwright over the phone's WebView DevTools socket — the driver the probes are built on.
//
// `chromium.connectOverCDP` attaches to the APK's WebView (first confirmed on the S25, 2026-09-23),
// which buys what cdp.js hand-rolls: locators that wait, network and console events, offline
// emulation. cdp.js stays as the dependency-free fallback and still owns adb and the socket lookup.
//
// Two rules carried over from cdp.js, because they were expensive:
//   - `tap` hit-tests before it touches. A coordinate that lands on nothing reads as a dead button
//     (BF-165 lost three rounds to that).
//   - `tap` does NOT centre the target. It scrolls only when the control is off screen, so a
//     scroll-restoration check is not measuring an offset the harness chose (BF-100's first run).
//
// `DEVICE_CDP_URL` points it at any other DevTools endpoint — a desktop Chromium for self-testing
// the harness. There is no adb there, so the system back falls back to `page.goBack()`, which is a
// different path from the Android back gesture and proves nothing about it.

const fs = require('node:fs');
const path = require('node:path');
const { adb, systemBack, requireOneDevice, findSocket, forward } = require('./cdp');

const OUT = process.env.DEVICE_PROBE_OUT || path.join(process.cwd(), 'device-probe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// playwright-core is not a direct dependency; it arrives through @playwright/test.
function playwright() {
  const test = require.resolve('@playwright/test', { paths: [process.cwd()] });
  return require(require.resolve('playwright-core', { paths: [test] }));
}

const INTERACTIVE = 'a,button,[role=button],[role=tab],[role=menuitem],[role=switch],[role=checkbox]';

class Device {
  constructor({ browser, context, page, cdp, onPhone }) {
    Object.assign(this, { browser, context, page, cdp, onPhone });
  }

  /** Where the app is, read in the page — never from an inspector's address bar. */
  state() {
    return this.page.evaluate(() => {
      const visible = (e) => e.getClientRects().length && !e.closest('[hidden],[aria-hidden=true],[inert]');
      const scroller = [...document.querySelectorAll('*')].find((e) => e.scrollTop > 0 && visible(e));
      return {
        path: location.pathname,
        search: location.search,
        tab: document.querySelector('nav a.text-brand')?.getAttribute('href') ?? null,
        scrollTop: scroller ? Math.round(scroller.scrollTop) : 0,
        dialogs: [...document.querySelectorAll('[role=dialog][data-state=open],[role=alertdialog][data-state=open]')]
          .map((d) => (d.querySelector('h2')?.textContent || '').trim().slice(0, 60)),
        historyLength: history.length,
        visibility: document.visibilityState,
      };
    });
  }

  /** A visible interactive control by its text. `exact` matches the whole trimmed text. */
  control(text, { exact = false, within = 'body' } = {}) {
    const re = exact ? new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') : null;
    return this.page.locator(within).locator(INTERACTIVE)
      .filter({ hasText: re ?? text }).filter({ visible: true }).first();
  }

  /** A real touch on a selector, a Locator, or `{ text, exact, within }`. */
  async tap(target, { scroll = true } = {}) {
    const loc = typeof target === 'string' ? this.page.locator(target).first()
      : target?.text ? this.control(target.text, target) : target;
    await loc.waitFor({ state: 'visible', timeout: 10_000 });
    if (scroll) await loc.scrollIntoViewIfNeeded();
    const hit = await loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      if (!top) return { ok: false, why: 'nothing hit-tests at its centre (outside the viewport?)' };
      if (top !== el && !el.contains(top) && !top.contains(el)) {
        return { ok: false, why: `covered by ${top.tagName.toLowerCase()}.${(top.getAttribute("class") || "").slice(0, 60)}${top.closest("button,a") ? ` inside "${(top.closest("button,a").getAttribute("aria-label") || top.closest("button,a").textContent || "").trim().slice(0, 40)}"` : ""}` };
      }
      return { ok: true, x, y };
    });
    if (!hit.ok) throw new Error(`tap refused: ${hit.why}`);
    const pt = [{ x: hit.x, y: hit.y, radiusX: 8, radiusY: 8, force: 1 }];
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return hit;
  }

  /**
   * Back to Home with the tab bar showing. Through the router, not repeated back presses: a probe
   * that navigated with `go()` has stacked entries, and four backs from `/program` once landed on
   * `/cardio` (first phone run, 2026-09-23).
   */
  async home() {
    if (await this.page.locator('nav a[href="/"]').filter({ visible: true }).first().isVisible()) return;
    await this.go('/', 1500);
    await this.page.locator('nav a[href="/"]').filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 10_000 });
  }

  /** Tab-bar navigation, the way a thumb does it. */
  async tab(href, settleMs = 1200) {
    await this.tap(this.page.locator(`nav a[href="${href}"]`).filter({ visible: true }).first());
    await sleep(settleMs);
  }

  /** The Android system back (KEYCODE_BACK). Off the phone this is `page.goBack()` — not the same path. */
  async back(settleMs = 1500) {
    // KEYCODE_BACK goes to whatever app holds the screen. Refuse unless it is this one — the same
    // rule as rawTap, for the same reason (2026-09-23: blind input closed the app on the owner's phone).
    if (this.onPhone && !(await this.inForeground())) throw new Error('back refused: the app is not in the foreground');
    if (this.onPhone) await systemBack();
    else await this.page.goBack().catch(() => {});
    await sleep(settleMs);
  }

  /** Whether the app still holds the foreground. `adb()` returns stdout as a STRING. */
  async inForeground() {
    if (!this.onPhone) return true;
    return /mCurrentFocus=[^\n]*com\.trainingai\.app/.test(await adb(['shell', 'dumpsys', 'window']));
  }

  /**
   * Raw input — a real finger where `x, y` (CSS px) says, which the app then interprets. The ONLY way
   * a script may send `adb shell input` tap/swipe. adb input is blind: it lands on whatever is on
   * screen. On 2026-09-23 taps meant for a Nutrition row landed on the launcher after the app had
   * left the foreground, opened another app, and closed this one — on the owner's phone. So both
   * helpers refuse unless the app is in the foreground AND on `expectPath`, checked immediately before
   * sending. Never call `adb shell input tap|swipe` directly from a probe.
   */
  async _guard(expectPath) {
    if (!this.onPhone) throw new Error('raw input is phone-only');
    if (!(await this.inForeground())) throw new Error('raw input refused: the app is not in the foreground');
    const { path } = await this.state();
    if (expectPath && path !== expectPath) throw new Error(`raw input refused: on ${path}, expected ${expectPath}`);
    return this.page.evaluate(() => devicePixelRatio);
  }

  async rawTap(x, y, { expectPath } = {}) {
    const dpr = await this._guard(expectPath);
    await adb(['shell', 'input', 'tap', String(Math.round(x * dpr)), String(Math.round(y * dpr))]);
  }

  async rawSwipe(x1, y1, x2, y2, { ms = 300, expectPath } = {}) {
    const dpr = await this._guard(expectPath);
    await adb(['shell', 'input', 'swipe', ...[x1, y1, x2, y2].map((v) => String(Math.round(v * dpr))), String(ms)]);
  }

  async bringToFront() {
    if (this.onPhone) await adb(['shell', 'am', 'start', '-n', 'com.trainingai.app/.MainActivity']);
    await sleep(2000);
  }

  /** Client-side navigation through Next's own router, so the tab shell is not torn down. */
  async go(route, settleMs = 1500) {
    await this.page.evaluate((r) => {
      const router = window.next?.router;
      if (router?.push) router.push(r); else location.assign(r);
    }, route);
    await sleep(settleMs);
  }

  /**
   * Every request the page makes, with the initiating stack — P1/P2/P7. Read over CDP rather than
   * `page.on('request')` because only CDP carries the initiator, which is how a request is traced to
   * the component that fired it. Production chunks are minified: the stack names a chunk and an
   * offset, not a component, unless source maps are served.
   */
  async recordNetwork({ bodies = null } = {}) {
    const t0 = Date.now();
    const byId = new Map();
    const entries = [];
    const onReq = (e) => {
      const frame = e.initiator?.stack?.callFrames?.[0];
      const row = {
        t: Date.now() - t0, method: e.request.method, url: e.request.url, type: e.type,
        initiator: frame ? `${frame.url.split('/').pop()}:${frame.lineNumber}:${frame.columnNumber}` : e.initiator?.type,
        status: null, fromServiceWorker: false, failed: null, tResp: null, tEnd: null, bytes: null,
      };
      byId.set(e.requestId, row);
      entries.push(row);
    };
    const onRes = (e) => {
      const row = byId.get(e.requestId);
      if (row) { row.status = e.response.status; row.fromServiceWorker = !!e.response.fromServiceWorker; row.tResp = Date.now() - t0; }
    };
    const onFail = (e) => { const row = byId.get(e.requestId); if (row) { row.failed = e.errorText; row.tEnd = Date.now() - t0; } };
    // `bodies`: a RegExp on the URL. Matching responses keep their body — how the first sitting told
    // a stale server answer from a right answer the card ignored (BF-177, 2026-09-23).
    const onDone = (e) => {
      const row = byId.get(e.requestId);
      if (row) { row.tEnd = Date.now() - t0; row.bytes = e.encodedDataLength; }
      if (!row || !bodies || !bodies.test(row.url)) return;
      this.cdp.send('Network.getResponseBody', { requestId: e.requestId })
        .then((b) => { row.body = b.base64Encoded ? '(binary)' : b.body; }).catch(() => {});
    };
    this.cdp.on('Network.loadingFinished', onDone);
    this.cdp.on('Network.requestWillBeSent', onReq);
    this.cdp.on('Network.responseReceived', onRes);
    this.cdp.on('Network.loadingFailed', onFail);
    await this.cdp.send('Network.enable');
    const api = (u) => { try { return new URL(u).pathname; } catch { return u; } };
    return {
      entries,
      now: () => Date.now() - t0,
      /** Requests still in flight (started, not finished or failed). */
      inFlight: (re = /\/api\//) => entries.filter((r) => r.tEnd === null && re.test(r.url)).length,
      /** Requests to paths matching `re` since `sinceMs` (from `now()`). */
      count: (re, sinceMs = 0) => entries.filter((r) => r.t >= sinceMs && re.test(api(r.url))).length,
      stop: () => {
        this.cdp.off('Network.requestWillBeSent', onReq);
        this.cdp.off('Network.responseReceived', onRes);
        this.cdp.off('Network.loadingFailed', onFail);
        this.cdp.off('Network.loadingFinished', onDone);
      },
    };
  }

  /**
   * P1's measurement: run `action` (a write, driven through the UI), then count requests to each
   * surface's endpoint in the `windowMs` after it — BEFORE any navigation. With `thenTab: [away,
   * back]`, flip tabs and count again. Zero before and ≥1 after is the Q-402 shape: the key was
   * evicted and the component reading it never re-ran. A zero is a result, not a failed probe.
   */
  async watchAfter(action, surfaces, { windowMs = 3000, thenTab = null } = {}) {
    const net = await this.recordNetwork();
    const counts = (since) => Object.fromEntries(Object.entries(surfaces).map(([k, re]) => [k, net.count(re, since)]));
    await action();
    const tWrite = net.now();
    await sleep(windowMs);
    const beforeNavigation = counts(tWrite);
    let afterTabSwitch = null;
    if (thenTab) {
      const tSwitch = net.now();
      await this.tab(thenTab[0]);
      await this.tab(thenTab[1]);
      await sleep(windowMs);
      afterTabSwitch = counts(tSwitch);
    }
    const writes = net.entries.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${new URL(r.url).pathname} → ${r.status ?? r.failed}`);
    net.stop();
    return { beforeNavigation, afterTabSwitch, writes };
  }

  /** Console messages and uncaught errors, verbatim, for grouping later — P7. */
  recordConsole() {
    const msgs = [];
    const onMsg = (m) => msgs.push({ type: m.type(), text: m.text().slice(0, 500) });
    const onErr = (e) => msgs.push({ type: 'pageerror', text: String(e?.message ?? e).slice(0, 500) });
    this.page.on('console', onMsg);
    this.page.on('pageerror', onErr);
    return { msgs, stop: () => { this.page.off('console', onMsg); this.page.off('pageerror', onErr); } };
  }

  /**
   * P8's switch. Emulated in the page's network stack, so it can flip mid-action. It does NOT reach
   * the native HTTP paths (the BLE ingest in Kotlin), and whether the service worker honours it on
   * this WebView is unverified — check `fromServiceWorker` rows before trusting an offline read.
   */
  async offline(on) { await this.context.setOffline(on); }

  /** Heap, DOM nodes and listener counts — P10. */
  async metrics() {
    await this.cdp.send('Performance.enable').catch(() => {});
    const { metrics } = await this.cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    const timers = await this.page.evaluate(() => window.__dvTimers ? { ...window.__dvTimers.live } : null);
    return {
      heapUsedMB: +(m.JSHeapUsedSize / 1048576).toFixed(1),
      heapTotalMB: +(m.JSHeapTotalSize / 1048576).toFixed(1),
      listeners: m.JSEventListeners, nodes: m.Nodes, documents: m.Documents, timers,
    };
  }

  /**
   * Count live timers from the start of the next document. Needs a reload to take effect, which
   * resets the session — run it at the start of a probe, never in the middle of one.
   */
  async instrumentTimersAndReload() {
    await this.context.addInitScript(() => {
      const live = { interval: 0, timeout: 0 };
      const ids = new Map();
      const wrap = (name, kind) => {
        const orig = window[name];
        window[name] = function (fn, ms, ...a) {
          let id;
          const cb = kind === 'timeout'
            ? function (...x) { if (ids.delete(id)) live.timeout--; return typeof fn === 'function' ? fn.apply(this, x) : undefined; }
            : fn;
          id = orig.call(window, cb, ms, ...a);
          ids.set(id, kind); live[kind]++;
          return id;
        };
      };
      const unwrap = (name) => {
        const orig = window[name];
        window[name] = function (id) { const k = ids.get(id); if (k) { ids.delete(id); live[k]--; } return orig.call(window, id); };
      };
      wrap('setInterval', 'interval'); wrap('setTimeout', 'timeout');
      unwrap('clearInterval'); unwrap('clearTimeout');
      window.__dvTimers = { live };
    });
    await this.page.reload({ waitUntil: 'load' });
    await sleep(3000);
  }

  /**
   * A read-only query against the app's own local SQLite (`trainingai`), through the Capacitor
   * plugin the app already opened — P3. SELECT only: this is the owner's real store.
   */
  async localQuery(sql, values = []) {
    if (!/^\s*(select|pragma|with)\b/i.test(sql)) throw new Error('localQuery is read-only: SELECT/PRAGMA/WITH only');
    return this.page.evaluate(async ({ sql, values }) => {
      const p = window.Capacitor?.Plugins?.CapacitorSQLite;
      if (!p) return { error: 'CapacitorSQLite not on Capacitor.Plugins' };
      try {
        const r = await p.query({ database: 'trainingai', statement: sql, values, readonly: false });
        return { rows: r.values ?? [] };
      } catch (e) { return { error: String(e?.message ?? e) }; }
    }, { sql, values });
  }

  /** A full-screen capture. On the phone, adb's (status and gesture bars included). */
  async shot(name) {
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${name}.png`);
    if (this.onPhone) fs.writeFileSync(file, await adbBinary(['exec-out', 'screencap', '-p']));
    else await this.page.screenshot({ path: file });
    return file;
  }

  async close() { await this.browser.close().catch(() => {}); }
}

// cdp.js's adb() decodes stdout as text, which corrupts a PNG.
function adbBinary(args) {
  const { execFile } = require('node:child_process');
  return new Promise((resolve, reject) => {
    execFile(process.env.ADB_PATH || 'adb', args, { encoding: 'buffer', maxBuffer: 64 << 20 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

async function attach({ match = 'trainingai' } = {}) {
  const { chromium } = playwright();
  let url = process.env.DEVICE_CDP_URL;
  const onPhone = !url;
  if (onPhone) {
    await requireOneDevice();
    url = await forward(await findSocket());
  }
  const browser = await chromium.connectOverCDP(url, { timeout: 15_000 });
  const context = browser.contexts()[0];
  if (!context) throw new Error('Attached, but the endpoint exposes no browser context');
  const page = context.pages().find((p) => p.url().includes(match)) ?? context.pages()[0];
  if (!page) throw new Error('Attached, but there is no page — is the app on a screen?');
  const cdp = await context.newCDPSession(page);
  return new Device({ browser, context, page, cdp, onPhone });
}

/** Write a probe's result where captures live (gitignored — the repo is public). */
function saveResult(name, data) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

module.exports = { attach, saveResult, sleep, Device, OUT };

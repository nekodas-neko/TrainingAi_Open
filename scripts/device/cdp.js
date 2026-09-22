'use strict';
//
// Talk to the WebView inside the installed APK, on a real S25, over USB.
//
// Why this exists: `playwright.config.ts` says it plainly — the e2e harness "drives the **web**
// build, where `getLocalStore` returns null", so a green run is evidence about the web path only.
// Three whole classes of check are unreachable from any sandbox as a result: native SQLite (every
// offline-first read), the real `env(safe-area-inset-*)` values, and what Samsung's WebView
// compositor actually paints. This module reaches all three, because it drives the real app.
//
// **Why raw CDP and not `chromium.connectOverCDP`.** That would be less code and would let the
// existing `e2e/**` specs run unchanged, which is the bigger prize — but it needs a *browser*
// target, and an Android WebView commonly exposes only page targets (`/json/version` with no
// `webSocketDebuggerUrl`). Rather than ship a harness that may not connect at all, this speaks the
// protocol to the page target directly, which always exists. Trying connectOverCDP against the
// same forwarded port is the natural next step once a device has confirmed this path works.
//
// ⚠ **NOT RUN AGAINST A DEVICE. Written blind.** No sandbox in this project has `adb` or a phone,
// so every line here is reasoned from the protocol, not observed. Treat the first run as the test:
// expect to fix something, and record what, rather than trusting a clean read.

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const ADB = process.env.ADB_PATH || 'adb';
const PORT = Number(process.env.DEVICE_CDP_PORT || 9222);

async function adb(args, opts = {}) {
  const { stdout } = await run(ADB, args, { maxBuffer: 8 << 20, ...opts });
  return stdout;
}

/** One connected device, or a named error — never a guess about which phone was meant. */
async function requireOneDevice() {
  let out;
  try {
    out = await adb(['devices']);
  } catch (err) {
    throw new Error(
      `Could not run \`${ADB}\`. Install platform-tools, or set ADB_PATH.\n  ${err.message}`,
    );
  }
  const ids = out.split('\n').slice(1)
    .map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/\s+/))
    .filter(([, state]) => state === 'device')
    .map(([id]) => id);
  if (ids.length === 0) {
    throw new Error(
      'No authorised device. Plug the S25 in, enable USB debugging, and accept the prompt on the\n' +
      'phone (a device listed as `unauthorized` means the prompt has not been accepted).',
    );
  }
  if (ids.length > 1) throw new Error(`More than one device: ${ids.join(', ')}. Unplug the others.`);
  return ids[0];
}

/**
 * The DevTools socket is `webview_devtools_remote_<pid>` and the pid changes on every app start,
 * so it is discovered rather than assumed. `/proc/net/unix` lists it once the WebView exists —
 * if the app has never been foregrounded since launch, there is nothing to find yet.
 */
async function findSocket() {
  const out = await adb(['shell', 'cat', '/proc/net/unix']);
  const names = [...out.matchAll(/@?(webview_devtools_remote_\d+)/g)].map((m) => m[1]);
  const unique = [...new Set(names)];
  if (!unique.length) {
    throw new Error(
      'No WebView DevTools socket on the device. Open the app and bring it to the foreground,\n' +
      'then retry. If it is still absent the installed APK is not debuggable — this harness needs\n' +
      'the assembleDebug build (MainActivity gates setWebContentsDebuggingEnabled on the\n' +
      "manifest's debuggable flag, so a release APK can never expose it).",
    );
  }
  // Several sockets means several WebView processes; the app's is the newest.
  return unique.sort((a, b) => Number(b.split('_').pop()) - Number(a.split('_').pop()))[0];
}

async function forward(socket) {
  await adb(['forward', `tcp:${PORT}`, `localabstract:${socket}`]);
  return `http://127.0.0.1:${PORT}`;
}

/** The app's page among whatever else the WebView holds — matched on the Railway origin. */
async function findTarget(base, { match = 'trainingai' } = {}) {
  const res = await fetch(`${base}/json/list`);
  if (!res.ok) throw new Error(`DevTools endpoint answered ${res.status} — is the forward up?`);
  const targets = await res.json();
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pages.length) throw new Error('The WebView exposes no page target. Is the app on a screen?');
  const hit = pages.find((t) => (t.url || '').includes(match)) ?? pages[0];
  return hit;
}

/**
 * A minimal CDP client. Node 22 ships a global WebSocket, so this needs no dependency —
 * deliberately, because a harness that only runs after an install is a harness nobody runs.
 */
class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else p.resolve(msg.result);
    });
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('DevTools connection closed'));
      this.pending.clear();
    });
  }

  send(method, params = {}, timeoutMs = 20_000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  /** Evaluate in the page. Promises are awaited; a thrown error comes back as a rejection. */
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails;
      throw new Error(`Page threw: ${e.exception?.description ?? e.text}`);
    }
    return r.result?.value;
  }

  async screenshot() {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(data, 'base64');
  }

  /**
   * Tap a selector, with the two conditions BF-165 paid three wrong conclusions to establish:
   * scroll it into view first, and assert it actually hit-tests there before dispatching. A raw
   * coordinate tap has no actionability check, so an off-screen control reads as a dead button —
   * which is exactly the false differential that sent that investigation down two blind alleys.
   */
  async tap(selector) {
    const box = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, why: 'no element matches' };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit) return { ok: false, why: 'nothing hit-tests at its centre — still outside the viewport' };
      if (hit !== el && !el.contains(hit) && !hit.contains(el)) {
        return { ok: false, why: 'another element is on top: ' + (hit.tagName + '.' + hit.className).slice(0, 80) };
      }
      return { ok: true, x, y };
    })()`);
    if (!box.ok) throw new Error(`tap(${selector}) refused: ${box.why}`);
    const pt = [{ x: box.x, y: box.y, radiusX: 8, radiusY: 8, force: 1 }];
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return box;
  }

  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

/** The Android system back. It is a Capacitor channel, not a DOM event — no CDP call reaches it. */
async function systemBack() {
  await adb(['shell', 'input', 'keyevent', '4']);
}

async function connect(opts = {}) {
  const device = await requireOneDevice();
  const socket = await findSocket();
  const base = await forward(socket);
  const target = await findTarget(base, opts);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DevTools websocket did not open in 15s')), 15_000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('DevTools websocket failed')); }, { once: true });
  });
  const session = new Session(ws);
  await session.send('Runtime.enable');
  await session.send('Page.enable');
  return { device, socket, target, session };
}

module.exports = { connect, systemBack, adb, requireOneDevice, findSocket, Session };

#!/usr/bin/env node
/**
 * #3761. Captures TrainingAi Preview's screens in a browser, signed in to a local server, so a
 * cloud session can check layout, text and where things lead without the phone.
 *
 *   node mobile/scripts/web-screens.mjs                       every screen, into the output folder
 *   node mobile/scripts/web-screens.mjs --screens home,more-data,health-day
 *   node mobile/scripts/web-screens.mjs --click steps.json    run a click script after the screens
 *   node mobile/scripts/web-screens.mjs --list                print the screen names and stop
 *   node mobile/scripts/web-screens.mjs --serve               sign in, then keep the app open on
 *                                                             the proxy for a person's own browser
 *
 * What it does, in order:
 *   1. Uses the Next server on --server (default http://localhost:3000), starting `pnpm dev` at the
 *      repository root if nothing answers there. Started that way it has no Gemini key and a
 *      zero AI call limit, and it is stopped when the script ends.
 *   2. Adds the dev-only preview data (scripts/local-db/seed-preview-screens.sql) to the local
 *      database, unless --no-seed. It is idempotent.
 *   3. Builds a development web export (`expo export --platform web --dev`) with the browser
 *      preview's sign-in switched on, unless --no-build reuses the last one.
 *   4. Serves it on a local proxy (default http://localhost:8099) that also forwards every other
 *      path to the Next server, so the app and the server share one origin. The proxy turns the
 *      server's final redirect to the app's callback scheme into a page that hands the callback
 *      URL to the app: the one hop a browser cannot make. Nothing on the server changes.
 *   5. Opens Chromium at 384 px wide, dark, signs in as test@local.dev through the app's real
 *      sign-in (the server's sign-in page, consent, PKCE exchange, bearer tokens).
 *   6. Opens each screen with the app's own navigation, waits for it to settle, and saves
 *      <name>.png plus index.json and index.md: screen → file → where it landed → console errors.
 *
 * Options:
 *   --out DIR         output folder (default: $TMPDIR/trainingai-web-screens)
 *   --screens a,b     only these screens (see --list)
 *   --click FILE      a JSON click script, run after the screens (format below)
 *   --server URL      the Next server (default http://localhost:3000)
 *   --port N          the proxy's port (default 8099)
 *   --height N        viewport height in px (default 832). A taller one shows more of a long screen.
 *   --scale N         device scale factor (default 1; 2 for screenshots a person will read)
 *   --settle MS       extra wait after each screen opens (default 1500)
 *   --light           light theme instead of dark
 *   --no-build        reuse the export in mobile/.web-preview-dist
 *   --no-seed         skip the preview data
 *   --serve           after signing in, keep the proxy running and print its address
 *   --verbose         print the app's and the sign-in popup's console as it runs
 *
 * Click script: a JSON array of steps, run in order.
 *   { "open": "more" }           open a screen from the list
 *   { "tap": "Data & Sync" }     tap the first visible element with exactly this text
 *   { "tap": "Sync", "exact": false }   …or containing it
 *   { "scroll": 600 }            scroll the screen's content down by px (negative is up)
 *   { "wait": 1000 }             wait ms
 *   { "capture": "data-sync" }   save <name>.png and add it to the index
 *
 * Needs the local Postgres from docs/local-dev-database.md (`pnpm db:local`). Playwright and
 * Chromium are preinstalled in cloud sessions; nothing is installed. Never point it at production:
 * the sign-in it uses exists only on a development server.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileDir = path.resolve(here, '..');
const rootDir = path.resolve(mobileDir, '..');
const distDir = path.join(mobileDir, '.web-preview-dist');
const require = createRequire(import.meta.url);

const EMAIL = 'test@local.dev';
const PASSWORD = 'testpass123';
const USER_TIMEZONE = 'Australia/Brisbane';
const CALLBACK_PREFIX = 'com.trainingai.app.dev:/auth/callback';
/** Must match WEB_PREVIEW_AUTH_MESSAGE in src/integrations/auth/web-preview.ts. */
const AUTH_MESSAGE = 'trainingai-web-preview-auth';
const LOCAL_DB =
  process.env.LOCAL_DATABASE_URL ||
  'postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433';

function parseArgs(argv) {
  const options = {
    out: path.join(os.tmpdir(), 'trainingai-web-screens'),
    screens: null,
    click: null,
    server: 'http://localhost:3000',
    port: 8099,
    height: 832,
    scale: 1,
    settle: 1500,
    dark: true,
    build: true,
    seed: true,
    serve: false,
    list: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--out') options.out = path.resolve(value());
    else if (arg === '--screens') options.screens = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--click') options.click = path.resolve(value());
    else if (arg === '--server') options.server = new URL(value()).origin;
    else if (arg === '--port') options.port = Number(value());
    else if (arg === '--height') options.height = Number(value());
    else if (arg === '--scale') options.scale = Number(value());
    else if (arg === '--settle') options.settle = Number(value());
    else if (arg === '--light') options.dark = false;
    else if (arg === '--no-build') options.build = false;
    else if (arg === '--no-seed') options.seed = false;
    else if (arg === '--serve') options.serve = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else throw new Error(`Unknown option ${arg}`);
  }
  const server = new URL(options.server);
  if (!['localhost', '127.0.0.1'].includes(server.hostname)) {
    throw new Error('--server must be a local server (localhost or 127.0.0.1).');
  }
  return options;
}

// ── Dates in the seeded user's timezone ─────────────────────────────────────────────────────────
function dayIn(tz, offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = parts.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + offsetDays, 12));
  return date.toISOString().slice(0, 10);
}
function mondayOf(day) {
  const date = new Date(`${day}T12:00:00Z`);
  const back = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}
function shiftDay(day, days) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// ── Local database lookups for the screens that need an id ──────────────────────────────────────
function psql(sql) {
  const result = spawnSync('psql', [LOCAL_DB, '-v', 'ON_ERROR_STOP=1', '-Atc', sql], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}
function lookups() {
  const user = `(SELECT id FROM users WHERE email = '${EMAIL}')`;
  return {
    workoutDate: psql(
      `SELECT (started_at AT TIME ZONE '${USER_TIMEZONE}')::date FROM workout_sessions WHERE user_id = ${user} AND completed_at IS NOT NULL ORDER BY started_at DESC LIMIT 1`,
    ),
    sessionId: psql(
      `SELECT ps.id FROM program_sessions ps JOIN programs p ON p.id = ps.program_id WHERE p.user_id = ${user} AND p.is_active ORDER BY ps.position LIMIT 1`,
    ),
  };
}

/**
 * The navigation list: every tab and panel, More's rows, and the main detail screens. Each entry
 * says how to open it with the app's own navigation (`window.__trainingaiPreview`).
 */
function screenList(ids) {
  const today = dayIn(USER_TIMEZONE);
  const lastWeek = shiftDay(mondayOf(today), -7);
  const yesterday = shiftDay(today, -1);
  const tab = (name) => ({ kind: 'tab', tab: name });
  const route = (tabName, value) => ({ kind: 'route', tab: tabName, route: value });
  const list = [
    ['home', tab('Home')],
    ['health-body', { kind: 'panel', panel: 'body' }],
    ['health-training', { kind: 'panel', panel: 'training' }],
    ['health-progress', { kind: 'panel', panel: 'progress' }],
    ['workout', tab('Workout')],
    ['nutrition', tab('Nutrition')],
    ['nutrition-day', { kind: 'nutrition-day', date: yesterday }],
    ['more', tab('More')],
    // More's rows, in the order they appear.
    ['profile-details', route('More', { screen: 'profile-details' })],
    ['profile-goals', route('More', { screen: 'profile-goals' })],
    ['programs', route('More', { screen: 'programs' })],
    ['clinical', route('More', { screen: 'clinical' })],
    ['health-data', route('More', { screen: 'health-data' })],
    ['more-devices', route('More', { screen: 'more-devices' })],
    ['more-signed-in-devices', route('More', { screen: 'more-signed-in-devices' })],
    ['collection', route('More', { screen: 'collection' })],
    ['year-review', route('More', { screen: 'year-review' })],
    ['settings', route('More', { screen: 'settings' })],
    ['more-data', route('More', { screen: 'more-data' })],
    ['more-about', route('More', { screen: 'more-about' })],
    ['more-admin', route('More', { screen: 'more-admin' })],
    ['more-account', route('More', { screen: 'more-account' })],
    // Detail screens.
    ['health-day', route('Health', { screen: 'health-day', date: today })],
    ['health-week', route('Health', { screen: 'health-week', week: lastWeek })],
    ['health-detail-sleep', route('Health', { screen: 'health-detail', detail: 'sleep' })],
    ['health-detail-readiness', route('Health', { screen: 'health-detail', detail: 'readiness' })],
    ['health-detail-activity', route('Health', { screen: 'health-detail', detail: 'activity' })],
    ['health-detail-heart-rate', route('Health', { screen: 'health-detail', detail: 'heart-rate' })],
    // A finished workout's day. (The workout logger, `workout-log`, shows only a workout in
    // progress in this browser's own journal: start one from workout-session with a click script.)
    ['workout-day', ids.workoutDate ? route('Health', { screen: 'health-day', date: ids.workoutDate }) : { kind: 'missing', why: 'no completed workout in the local database' }],
    ['workout-session', ids.sessionId ? route('Workout', { screen: 'workout-session', sessionId: ids.sessionId, fullOverride: false }) : { kind: 'missing', why: 'no active program session in the local database' }],
    ['exercise-library', route('Workout', { screen: 'exercise-library' })],
    ['cardio', route('Workout', { screen: 'cardio' })],
    ['cardio-plan', route('Workout', { screen: 'cardio-plan' })],
    ['running', route('Workout', { screen: 'running' })],
    ['guided-walk', route('Workout', { screen: 'guided-walk' })],
    ['fitness-baselines', route('Workout', { screen: 'fitness-baselines' })],
    ['coach', route('Home', { screen: 'coach', scope: 'general' })],
  ];
  return new Map(list);
}

// ── Next server ─────────────────────────────────────────────────────────────────────────────────
async function reachable(origin) {
  try {
    const response = await fetch(`${origin}/api/status`, { signal: AbortSignal.timeout(5000) });
    return response.status < 500;
  } catch {
    return false;
  }
}
async function ensureServer(origin) {
  if (await reachable(origin)) {
    console.log(`[web-screens] using the server on ${origin}`);
    return null;
  }
  const port = new URL(origin).port || '3000';
  console.log(`[web-screens] starting pnpm dev on port ${port} (no Gemini key, AI limit 0)…`);
  const env = { ...process.env, GOOGLE_GENERATIVE_AI_API_KEY: '', AI_DEV_DAILY_CALL_LIMIT: '0', PORT: port };
  // A provisioned DATABASE_URL would win over .env.local and point at a remote database
  // (docs/local-dev-database.md); the local one is the only one this script may use.
  env.DATABASE_URL = LOCAL_DB;
  delete env.DATABASE_SSL;
  const child = spawn('pnpm', ['dev', '--port', port], {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const log = fs.createWriteStream(path.join(os.tmpdir(), 'trainingai-web-screens-next.log'));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error('pnpm dev exited; see $TMPDIR/trainingai-web-screens-next.log');
    if (await reachable(origin)) return child;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('pnpm dev did not answer within 4 minutes');
}

// ── Export ──────────────────────────────────────────────────────────────────────────────────────
function buildExport(proxyOrigin) {
  console.log('[web-screens] building the development web export…');
  const result = spawnSync(
    'pnpm',
    ['exec', 'expo', 'export', '--platform', 'web', '--dev', '--output-dir', distDir],
    {
      cwd: mobileDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        EXPO_PUBLIC_API_URL: proxyOrigin,
        EXPO_PUBLIC_WEB_PREVIEW_AUTH: '1',
        CI: '1',
      },
    },
  );
  if (result.status !== 0) throw new Error('expo export failed');
}

// ── Proxy: the export and the Next server on one origin ────────────────────────────────────────
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
};
function returnPage(callbackUrl) {
  // The opener checks this message's origin and type; the URL is the server's own callback.
  const message = JSON.stringify({ type: AUTH_MESSAGE, url: callbackUrl }).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><title>Returning to the app</title>
<body style="background:#111;color:#ddd;font:16px sans-serif;padding:24px">Returning to the app…
<script>window.opener && window.opener.postMessage(${message}, location.origin);</script></body>`;
}
function startProxy(port, serverOrigin) {
  const upstream = new URL(serverOrigin);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/sw.js') {
      // The web app's service worker would take over this shared origin, the preview included.
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    const local = path.join(distDir, decodeURIComponent(url.pathname));
    if (
      req.method === 'GET' &&
      local.startsWith(distDir) &&
      (url.pathname === '/' || (fs.existsSync(local) && fs.statSync(local).isFile()))
    ) {
      const file = url.pathname === '/' ? path.join(distDir, 'index.html') : local;
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
    const forward = http.request(
      {
        host: upstream.hostname,
        port: upstream.port || 80,
        method: req.method,
        path: req.url,
        // Auth.js builds its redirects from these; without them they point past the proxy.
        headers: {
          ...req.headers,
          'x-forwarded-host': `localhost:${port}`,
          'x-forwarded-proto': 'http',
          'accept-encoding': 'identity',
        },
      },
      (answer) => {
        const location = answer.headers.location;
        if (answer.statusCode >= 300 && answer.statusCode < 400 && location?.startsWith(CALLBACK_PREFIX)) {
          // Keep the cookie changes (the server clears its session here), drop the redirect.
          const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
          if (answer.headers['set-cookie']) headers['Set-Cookie'] = answer.headers['set-cookie'];
          res.writeHead(200, headers);
          res.end(returnPage(location));
          answer.resume();
          return;
        }
        // Next builds Auth.js's URLs from its own address (the begin route's comment explains
        // why), so a redirect or an auth reply can name the server's origin instead of this one.
        const headers = { ...answer.headers };
        if (location?.startsWith(upstream.origin)) {
          headers.location = `http://localhost:${port}${location.slice(upstream.origin.length)}`;
        }
        if (url.pathname.startsWith('/api/auth/') && /json/.test(answer.headers['content-type'] ?? '')) {
          const chunks = [];
          answer.on('data', (chunk) => chunks.push(chunk));
          answer.on('end', () => {
            const body = Buffer.concat(chunks)
              .toString('utf8')
              .split(upstream.origin)
              .join(`http://localhost:${port}`);
            delete headers['content-length'];
            delete headers['content-encoding'];
            res.writeHead(answer.statusCode ?? 502, headers);
            res.end(body);
          });
          return;
        }
        res.writeHead(answer.statusCode ?? 502, headers);
        answer.pipe(res);
      },
    );
    forward.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(forward);
  });
  // Next's dev reload socket, so the sign-in pages behave as they do on the server itself.
  server.on('upgrade', (req, socket, head) => {
    // Expo's dev-tools sockets have no server here; only Next's reload socket is forwarded.
    if (!req.url?.startsWith('/_next/')) {
      socket.destroy();
      return;
    }
    const target = net.connect(Number(upstream.port || 80), upstream.hostname, () => {
      target.write(
        `${req.method} ${req.url} HTTP/1.1\r\n` +
          Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
          '\r\n\r\n',
      );
      if (head.length) target.write(head);
      target.pipe(socket);
      socket.pipe(target);
    });
    target.on('error', () => socket.destroy());
    socket.on('error', () => target.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, 'localhost', () => resolve(server));
  });
}

// ── Browser ─────────────────────────────────────────────────────────────────────────────────────
/** Signed in once the app has saved a session for an account (`fitnessai.session.v1`). */
async function waitSignedIn(page, timeout) {
  await page.waitForFunction(
    () => {
      try {
        const saved = JSON.parse(window.localStorage.getItem('fitnessai.session.v1') ?? 'null');
        return !!saved?.accessToken && typeof saved.userId === 'string';
      } catch {
        return false;
      }
    },
    null,
    { timeout },
  );
}
async function signIn(page, verbose) {
  await page.waitForFunction(() => '__trainingaiPreview' in window, null, { timeout: 120_000 });
  if (await waitSignedIn(page, 5_000).then(() => true, () => false)) {
    console.log('[web-screens] already signed in');
    return;
  }
  await page.evaluate(() => window.__trainingaiPreview.open('More', { screen: 'more-account' }));
  const button = page.getByText('Sign in with Google or email', { exact: true });
  try {
    await button.waitFor({ timeout: 60_000 });
  } catch {
    throw new Error('The account screen showed no sign-in button. Is the export a --dev build?');
  }
  const [popup] = await Promise.all([page.waitForEvent('popup'), button.click()]);
  try {
    await signInPopup(popup, verbose);
  } catch (error) {
    // Where the sign-in stopped, for the person reading the failure.
    const shot = path.join(os.tmpdir(), 'trainingai-web-screens-sign-in.png');
    if (!popup.isClosed()) {
      await popup.screenshot({ path: shot }).catch(() => undefined);
      console.error(`[web-screens] sign-in stopped at ${popup.url()} (screenshot: ${shot})`);
    }
    throw error;
  }
  try {
    await waitSignedIn(page, 90_000);
  } catch (error) {
    const shot = path.join(os.tmpdir(), 'trainingai-web-screens-sign-in.png');
    await page.screenshot({ path: shot }).catch(() => undefined);
    console.error(`[web-screens] the app did not finish signing in (screenshot: ${shot})`);
    throw error;
  }
  console.log('[web-screens] signed in as', EMAIL);
}
/**
 * Home opens the morning check-in sheet once a day, over every screen. Closing it is what a
 * person does, and it stays closed for the day.
 */
async function closeMorningCheckIn(page) {
  await page.evaluate(() => window.__trainingaiPreview.selectTab('Home'));
  const sheet = page.getByText('Morning check-in', { exact: true }).first();
  if (await sheet.waitFor({ timeout: 8_000 }).then(() => true, () => false)) {
    await page.getByRole('button', { name: 'Close dialog' }).first().click().catch(() => undefined);
    await page.waitForTimeout(800);
  }
}
async function signInPopup(popup, verbose) {
  if (verbose) {
    popup.on('console', (m) => console.log('[popup console]', m.type(), m.text().slice(0, 300)));
    popup.on('response', (r) => {
      if (r.url().includes('/api/auth/')) console.log('[popup]', r.status(), r.url());
    });
  }
  // The form is a client component: typed into before React hydrates, it submits empty fields. A
  // first `pnpm dev` compile of the page can take a minute.
  await popup.waitForLoadState('load', { timeout: 120_000 });
  await popup.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => undefined);
  const email = popup.locator('input[type="email"], input[name="email"]').first();
  const password = popup.locator('input[type="password"]').first();
  for (let attempt = 0; attempt < 10; attempt++) {
    await email.fill(EMAIL, { timeout: 60_000 });
    await password.fill(PASSWORD);
    await popup.waitForTimeout(300);
    if ((await email.inputValue()) === EMAIL && (await password.inputValue()) === PASSWORD) break;
  }
  await popup.getByRole('button', { name: 'Sign in with email' }).click();
  // The consent page: "Continue as …? Allow the TrainingAi Android development app to use this account."
  await popup.getByText('Continue as', { exact: false }).waitFor({ timeout: 120_000 });
  await popup.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
  await popup.getByRole('button', { name: 'Continue to app' }).click();
}
async function openScreen(page, how) {
  await page.evaluate((step) => {
    const preview = window.__trainingaiPreview;
    if (step.kind === 'tab') preview.selectTab(step.tab);
    else if (step.kind === 'panel') {
      preview.selectTab('Health');
      preview.healthPanel(step.panel);
    } else if (step.kind === 'nutrition-day') {
      preview.selectTab('Nutrition');
      preview.nutritionDate(step.date);
    } else if (step.kind === 'route') preview.open(step.tab, step.route);
  }, how);
}
/**
 * Waits for the network to go quiet and the screen's own spinners (react-native-web renders an
 * ActivityIndicator as role="progressbar") to go, up to 20 s, then `ms` more for layout.
 * A screen that is still loading after that is captured as it is; its index row says so.
 */
async function settle(page, ms) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page
    .waitForFunction(
      () =>
        !window.__webScreensSpinning(),
      null,
      { timeout: 20_000, polling: 250 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(ms);
}
async function stillLoading(page) {
  return page.evaluate(() => window.__webScreensSpinning());
}
/**
 * A visible spinner on the screen in front: react-native-web's ActivityIndicator is the one
 * progressbar with aria-valuemax and no aria-valuenow (a plain bar such as More's XP bar has
 * neither), and one inside a screen kept alive behind the front one (aria-hidden) does not count.
 */
function spinningProbe() {
  window.__webScreensSpinning = () =>
    [...document.querySelectorAll('[role="progressbar"][aria-valuemax]:not([aria-valuenow])')].some((el) => {
      const box = el.getBoundingClientRect();
      return (
        box.width > 0 &&
        box.height > 0 &&
        el.offsetParent !== null &&
        !el.closest('[aria-hidden="true"]')
      );
    });
}
/** The element that scrolls the open screen: the largest visible scrollable one. */
async function scrollBy(page, px) {
  await page.evaluate((delta) => {
    const candidates = [...document.querySelectorAll('div')].filter((el) => {
      const style = getComputedStyle(el);
      return (
        /(auto|scroll)/.test(style.overflowY) &&
        el.scrollHeight > el.clientHeight &&
        el.getBoundingClientRect().width > 0 &&
        el.offsetParent !== null
      );
    });
    candidates.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
    candidates[0]?.scrollBy(0, delta);
  }, px);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const proxyOrigin = `http://localhost:${options.port}`;
  if (options.list) {
    for (const name of screenList({ workoutDate: '2026-01-01', sessionId: 'id' }).keys()) console.log(name);
    return;
  }
  const started = await ensureServer(options.server);
  const cleanup = () => {
    if (started && started.exitCode === null) {
      try {
        process.kill(-started.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  };
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  let proxy = null;
  let browser = null;
  try {
    if (options.seed) {
      const seed = spawnSync(
        'psql',
        [LOCAL_DB, '-v', 'ON_ERROR_STOP=1', '-qf', path.join(rootDir, 'scripts/local-db/seed-preview-screens.sql')],
        { encoding: 'utf8' },
      );
      if (seed.status !== 0) console.warn('[web-screens] preview seed failed:', seed.stderr.trim());
      else console.log('[web-screens] preview data in place');
    }
    if (options.build || !fs.existsSync(path.join(distDir, 'index.html'))) buildExport(proxyOrigin);
    proxy = await startProxy(options.port, options.server);
    console.log(`[web-screens] app on ${proxyOrigin}`);

    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 384, height: options.height },
      deviceScaleFactor: options.scale,
      colorScheme: options.dark ? 'dark' : 'light',
      timezoneId: USER_TIMEZONE,
      locale: 'en-AU',
      hasTouch: true,
    });
    // The export's dev client keeps reconnecting to Expo's dev-tools socket, which only a Metro
    // server has; held open here, it stays quiet instead of filling every screen's errors.
    await context.routeWebSocket(/\/expo-dev-plugins\/|\/message\b|\/hot\b/, () => {});
    await context.addInitScript(spinningProbe);
    const page = await context.newPage();
    let errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text().slice(0, 500));
    });
    if (options.verbose) {
      page.on('console', (m) => console.log('[app console]', m.type(), m.text().slice(0, 300)));
      page.on('pageerror', (e) => console.log('[app pageerror]', e.stack?.slice(0, 1500)));
    }
    page.on('pageerror', (error) => errors.push(`pageerror: ${String(error.message).slice(0, 500)}`));
    await page.goto(proxyOrigin, { waitUntil: 'domcontentloaded' });
    await signIn(page, options.verbose);
    await settle(page, options.settle);
    await closeMorningCheckIn(page);

    if (options.serve) {
      await browser.close();
      browser = null;
      console.log(`[web-screens] serving ${proxyOrigin}. Sign in there with ${EMAIL} / ${PASSWORD}. Ctrl-C stops.`);
      await new Promise(() => {});
    }

    fs.mkdirSync(options.out, { recursive: true });
    const screens = screenList(lookups());
    const wanted = options.screens ?? (options.click ? [] : [...screens.keys()]);
    const unknown = wanted.filter((name) => !screens.has(name));
    if (unknown.length) throw new Error(`Unknown screens: ${unknown.join(', ')} (see --list)`);
    const index = [];
    const capture = async (name, extra = {}) => {
      const file = `${name}.png`;
      await page.screenshot({ path: path.join(options.out, file) });
      const where = await page.evaluate(() => window.__trainingaiPreview?.where() ?? null);
      const loading = await stillLoading(page);
      index.push({ screen: name, file, where, stillLoading: loading, consoleErrors: errors, ...extra });
      console.log(`[web-screens] ${name}: ${errors.length ? `${errors.length} console error(s)` : 'ok'}`);
      errors = [];
    };
    for (const name of wanted) {
      const how = screens.get(name);
      if (how.kind === 'missing') {
        index.push({ screen: name, file: null, where: null, consoleErrors: [], skipped: how.why });
        console.log(`[web-screens] ${name}: skipped, ${how.why}`);
        continue;
      }
      errors = [];
      // From the tab root each time, so one screen's state never leaks into the next.
      await page.evaluate(() => window.__trainingaiPreview.selectTab('Home'));
      await openScreen(page, how);
      await settle(page, options.settle);
      await capture(name);
    }
    if (options.click) {
      const steps = JSON.parse(fs.readFileSync(options.click, 'utf8'));
      if (!Array.isArray(steps)) throw new Error('The click script must be a JSON array of steps.');
      errors = [];
      for (const step of steps) {
        if (step.open) {
          const how = screens.get(step.open);
          if (!how || how.kind === 'missing') throw new Error(`Cannot open ${step.open}`);
          await page.evaluate(() => window.__trainingaiPreview.selectTab('Home'));
          await openScreen(page, how);
          await settle(page, options.settle);
        } else if (step.tap) {
          const target = page.getByText(step.tap, { exact: step.exact !== false });
          const visible = target.filter({ visible: true }).first();
          await visible.click({ timeout: 15_000 });
          await settle(page, options.settle);
        } else if (typeof step.scroll === 'number') {
          await scrollBy(page, step.scroll);
          await page.waitForTimeout(400);
        } else if (typeof step.wait === 'number') {
          await page.waitForTimeout(step.wait);
        } else if (step.capture) {
          await capture(String(step.capture).replace(/[^A-Za-z0-9_-]/g, '-'), { clickScript: true });
        } else {
          throw new Error(`Unknown click step: ${JSON.stringify(step)}`);
        }
      }
    }
    fs.writeFileSync(path.join(options.out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    const lines = [
      `# TrainingAi Preview screens, ${new Date().toISOString()}`,
      '',
      `384 × ${options.height} px, ${options.dark ? 'dark' : 'light'}, signed in as ${EMAIL} on a local server.`,
      '',
      '| Screen | File | Landed on | Still loading | Console errors |',
      '|---|---|---|---|---|',
      ...index.map((row) => {
        const landed = row.where ? `${row.where.tab}${row.where.screen ? ` › ${row.where.screen}` : ''}` : '—';
        const errs = row.skipped
          ? `skipped: ${row.skipped}`
          : row.consoleErrors.length
            ? row.consoleErrors.map((e) => e.replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 200)).join('<br>')
            : 'none';
        return `| ${row.screen} | ${row.file ?? '—'} | ${landed} | ${row.stillLoading ? 'yes' : ''} | ${errs} |`;
      }),
      '',
    ];
    fs.writeFileSync(path.join(options.out, 'index.md'), lines.join('\n'));
    const withErrors = index.filter((row) => row.consoleErrors.length).length;
    console.log(
      `[web-screens] ${index.filter((row) => row.file).length} captured, ${withErrors} with console errors, ` +
        `${index.filter((row) => row.skipped).length} skipped → ${options.out}`,
    );
  } finally {
    await browser?.close().catch(() => undefined);
    proxy?.close();
    cleanup();
  }
}

main().catch((error) => {
  console.error('[web-screens]', error instanceof Error ? error.message : error);
  process.exit(1);
});

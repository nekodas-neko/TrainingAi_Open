#!/usr/bin/env node
'use strict';
//
// `node scripts/device/tour.js [routes.json]` — walk a set of screens and capture each one.
//
// This exists to answer one question: how does an agent that is NOT on this machine review the
// running app? It cannot see the phone, and asking a person to screenshot every screen does not
// scale past a handful. So: capture here, read it here, and send the FINDINGS on as text — the repo
// is public, so the images themselves never leave this machine (see the README).
//
// Each screen yields more than a picture. The **digest** is a small DOM summary taken in the page:
// the real route, what the tab bar thinks is active, any visible error text, and the computed
// bottom padding of the lowest action row against the real safe-area inset. A reviewer can answer
// most "is this feature working" questions from the digest alone, and use the image for the half
// that is genuinely visual.
//
// ⛔ The route is read from `location.pathname` IN THE PAGE, never from an inspector's address bar.
// That bar updates on `Page.frameNavigated`, which `history.replaceState` does not fire — so on
// this app it goes stale and stays stale. That artifact nearly got a shipped fix recorded as
// failing on device (LA-109, 2026-09-22).
//
// ⚠ NOT RUN AGAINST A DEVICE. See the header of cdp.js.

const fs = require('node:fs');
const path = require('node:path');
const { connect } = require('./cdp');

const OUT = process.env.DEVICE_PROBE_OUT || path.join(process.cwd(), 'device-probe');

// The tab roots plus the screens the backlog asks about most. Override with a JSON array of paths.
const DEFAULT_ROUTES = [
  '/', '/health', '/workout', '/nutrition', '/more',
  '/cardio', '/activity', '/config', '/more/about',
];

const DIGEST = `(() => {
  const pick = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : null;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:-9999px;padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);
  const inset = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();

  // The lowest fixed/sticky element that holds a button — the shape the floored-utility rule guards.
  let lowest = null, lowestBottom = -1;
  for (const el of document.querySelectorAll('div,nav,footer,form')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (!el.querySelector('button,a[href]')) continue;
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.bottom < lowestBottom) continue;
    lowestBottom = r.bottom; lowest = { el, cs };
  }

  return {
    route: location.pathname,
    title: document.title,
    activeTab: pick(document.querySelector('[aria-current="page"],[data-active="true"]')),
    headings: [...document.querySelectorAll('h1,h2')].slice(0, 4).map((h) => pick(h)),
    errorish: [...document.querySelectorAll('[role="alert"],[data-error]')].map(pick).filter(Boolean).slice(0, 4),
    buttons: document.querySelectorAll('button:not([disabled])').length,
    safeAreaBottomPx: inset,
    lowestActionRowPaddingBottom: lowest ? lowest.cs.paddingBottom : null,
    clearsGestureBar: lowest ? (parseFloat(lowest.cs.paddingBottom) || 0) >= inset : null,
    scrollsHorizontally: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
})()`;

async function main() {
  const file = process.argv[2];
  const routes = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : DEFAULT_ROUTES;
  const { session } = await connect();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(OUT, `tour-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const results = [];

  for (const route of routes) {
    const slug = route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-');
    let digest = null, error = null;
    try {
      // Client-side navigation, so the shell is not torn down — the same path a tap takes.
      await session.evaluate(`(async () => {
        history.pushState({}, '', ${JSON.stringify(route)});
        dispatchEvent(new PopStateEvent('popstate'));
        await new Promise((r) => setTimeout(r, 900));
      })()`);
      digest = await session.evaluate(DIGEST);
      fs.writeFileSync(path.join(dir, `${slug}.png`), await session.screenshot());
    } catch (err) {
      error = err.message;
    }
    results.push({ route, slug, digest, error });
    const mark = error ? '✗' : (digest?.route === route ? '✓' : '~');
    console.log(`  ${mark} ${route}${error ? ` — ${error}` : ''}` +
      (digest && digest.route !== route ? `  (landed on ${digest.route})` : ''));
  }

  fs.writeFileSync(path.join(dir, 'tour.json'), JSON.stringify({ takenAt: stamp, results }, null, 2));
  console.log(`\n  ${results.length} screens → ${dir}`);
  console.log('  ⛔ Never commit or push these images: this repository is PUBLIC and they show the owner’s');
  console.log('    real account. Read them here and write the findings down as text (see the README).');
  console.log('  ⚠ A `~` means the app did not end up where it was sent — often correct (a guard,');
  console.log('    a redirect), and always worth reading before treating the capture as that screen.\n');
  session.close();
}

main().catch((err) => { console.error(`\n\x1b[31m✗\x1b[0m ${err.message}\n`); process.exitCode = 1; });

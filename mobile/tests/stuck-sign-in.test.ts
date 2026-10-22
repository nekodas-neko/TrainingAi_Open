import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import {
  AUTH_CALLBACK,
  AccountSession,
  FOREGROUND_CALLBACK_WAIT,
  STUCK_ATTEMPT_GRACE,
} from "../src/features/account/session.ts";
import type { AuthPlatform } from "../src/features/account/session.ts";

const origin = "https://example.com";
const token = "1aaad26d-22ef-4b26-98ba-d55d2d166f70";
const profile = {
  id: "user-1",
  email: "me@example.com",
  name: "Sam",
  timezone: null,
  isActive: true,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const random = (n: number) => String.fromCharCode(64 + n).repeat(43);
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** A fake browser whose sign-in tab never reports back until the test settles it. */
function fixture(t: TestContext) {
  t.mock.timers.enable({
    apis: ["setTimeout", "Date"],
    now: 1_800_000_000_000,
  });
  const storage = new Map<string, string>();
  const opened: URL[] = [];
  const settle: ((value: { type: string; url?: string }) => void)[] = [];
  let counter = 0;
  const platform: AuthPlatform = {
    get: async (key) => storage.get(key) ?? null,
    set: async (key, value) => {
      storage.set(key, value);
    },
    remove: async (key) => {
      storage.delete(key);
    },
    random: async () => random(++counter),
    challenge: async (verifier) => verifier,
    open: (url) => {
      opened.push(new URL(url));
      return new Promise((resolve) => settle.push(resolve));
    },
    dismiss() {},
  };
  const exchanged: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/auth/exchange-mobile-token") {
      exchanged.push(path);
      return json({
        ok: true,
        tokenType: "Bearer",
        accessToken: "session",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });
    }
    return json({ user: profile, signInProviders: ["google"] });
  });
  const controller = new AccountSession(origin, platform);
  const events = () => controller.diagnostics.events.map((e) => e.event);
  const callbackFor = (attempt: number) =>
    `${AUTH_CALLBACK}?state=${opened[attempt].searchParams.get("state")}&token=${token}`;
  return {
    controller,
    storage,
    opened,
    settle,
    exchanged,
    events,
    callbackFor,
  };
}

async function start(f: ReturnType<typeof fixture>) {
  await f.controller.initialize(null);
  void f.controller.signIn();
  await flush();
  assert.equal(f.controller.state.status, "signingIn");
}

test("a tap after the grace period replaces a stuck attempt with a fresh one", async (t) => {
  const f = fixture(t);
  await start(f);
  const firstState = f.opened[0].searchParams.get("state");
  t.mock.timers.tick(STUCK_ATTEMPT_GRACE);
  assert.equal(f.controller.state.attemptStale, true);
  void f.controller.signIn();
  await flush();
  assert.equal(f.opened.length, 2);
  assert.notEqual(f.opened[1].searchParams.get("state"), firstState);
  assert.notEqual(
    f.opened[1].searchParams.get("challenge"),
    f.opened[0].searchParams.get("challenge"),
  );
  assert.equal(f.controller.state.status, "signingIn");
  assert.equal(f.controller.state.attemptStale, false);
  assert.equal(
    JSON.parse(f.storage.get("fitnessai.pending.v1")!).state,
    f.opened[1].searchParams.get("state"),
  );
  assert.ok(f.events().includes("attempt_replaced"));
  // The abandoned browser promise settling afterwards must not disturb the new attempt.
  f.settle[0]({ type: "dismiss" });
  await flush();
  assert.equal(f.controller.state.status, "signingIn");
});

test("a tap within the grace period changes nothing", async (t) => {
  const f = fixture(t);
  await start(f);
  t.mock.timers.tick(STUCK_ATTEMPT_GRACE - 1);
  assert.equal(f.controller.state.attemptStale, false);
  void f.controller.signIn();
  await flush();
  assert.equal(f.opened.length, 1);
  assert.equal(f.controller.state.status, "signingIn");
  assert.ok(!f.events().includes("attempt_replaced"));
});

test("returning to the foreground with no callback clears the attempt and says so", async (t) => {
  const f = fixture(t);
  await start(f);
  f.controller.returnedToForeground();
  t.mock.timers.tick(FOREGROUND_CALLBACK_WAIT - 1);
  assert.equal(f.controller.state.status, "signingIn");
  t.mock.timers.tick(1);
  await flush();
  assert.equal(f.controller.state.status, "signedOut");
  assert.equal(f.controller.state.message, "Sign-in didn't finish. Try again.");
  assert.equal(f.storage.has("fitnessai.pending.v1"), false);
  assert.equal(f.controller.diagnostics.hasPending, false);
  assert.ok(f.events().includes("attempt_cleared_on_return"));
});

test("a callback that arrives during the foreground wait still signs in", async (t) => {
  const f = fixture(t);
  await start(f);
  f.controller.returnedToForeground();
  t.mock.timers.tick(FOREGROUND_CALLBACK_WAIT - 1);
  await f.controller.complete(f.callbackFor(0));
  t.mock.timers.tick(FOREGROUND_CALLBACK_WAIT);
  await flush();
  assert.equal(f.controller.state.status, "signedIn");
  assert.ok(!f.events().includes("attempt_cleared_on_return"));
});

test("a late callback for a cleared attempt is rejected and does not sign in", async (t) => {
  const f = fixture(t);
  await start(f);
  const late = f.callbackFor(0);
  f.controller.returnedToForeground();
  t.mock.timers.tick(FOREGROUND_CALLBACK_WAIT);
  await flush();
  assert.equal(f.controller.state.status, "signedOut");
  await f.controller.complete(late);
  assert.equal(f.controller.state.status, "signedOut");
  assert.equal(f.controller.state.hasSession, false);
  assert.equal(f.exchanged.length, 0);
  assert.ok(f.events().includes("callback_without_attempt"));
});

test("a late callback for a replaced attempt is rejected and does not sign in", async (t) => {
  const f = fixture(t);
  await start(f);
  const late = f.callbackFor(0);
  t.mock.timers.tick(STUCK_ATTEMPT_GRACE);
  void f.controller.signIn();
  await flush();
  await f.controller.complete(late);
  assert.equal(f.controller.state.hasSession, false);
  assert.notEqual(f.controller.state.status, "signedIn");
  assert.equal(f.exchanged.length, 0);
  assert.ok(f.events().includes("callback_rejected"));
});

test("a normal sign-in still works end to end", async (t) => {
  const f = fixture(t);
  await start(f);
  f.settle[0]({ type: "success", url: f.callbackFor(0) });
  await flush();
  assert.equal(f.controller.state.status, "signedIn");
  assert.equal(f.controller.state.profile?.id, profile.id);
  assert.equal(f.exchanged.length, 1);
  assert.equal(f.storage.has("fitnessai.pending.v1"), false);
  t.mock.timers.tick(STUCK_ATTEMPT_GRACE + FOREGROUND_CALLBACK_WAIT);
  await flush();
  assert.equal(f.controller.state.status, "signedIn");
  assert.deepEqual(
    f
      .events()
      .filter((e) =>
        ["browser_requested", "browser_success", "callback_received"].includes(
          e,
        ),
      ),
    ["browser_requested", "browser_success", "callback_received"],
  );
});

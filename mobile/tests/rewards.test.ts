import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  LEVEL_THRESHOLDS,
  getBadgeTier,
  getLevelLabel,
} from "@trainingai/shared/achievement-display";
import { createLocalStorage } from "../src/core/storage/LocalStorage.ts";
import { WorkoutResources } from "../src/features/workouts/data/WorkoutResources.ts";
import {
  achievementsSpec,
  type Achievement,
} from "../src/features/rewards/data/models.ts";
import { withRewardState } from "../src/features/rewards/data/dependencies.ts";
import { markSeen, readSeen } from "../src/features/rewards/data/seen.ts";
import { earnedXp, settledXp } from "../src/features/rewards/data/xp.ts";
import {
  achievementCounts,
  achievementGroups,
  levelHeadline,
  levelProgress,
  levelRows,
  levelSheetHero,
  recentUnlocked,
  tierOf,
  unseenUnlocks,
  xpGained,
  xpSources,
} from "../src/features/rewards/data/view.ts";
import {
  achievementIcon,
  achievementIcons,
} from "../src/features/rewards/components/achievementIcons.ts";
import { tint } from "../src/features/rewards/components/tint.ts";
import { createTheme } from "../src/shared/theme/theme.ts";
import { sqliteFixture } from "./storage-fixture.ts";

const row = (id: string, over: Partial<Achievement> = {}): Achievement => ({
  id,
  name: id,
  description: `${id} description`,
  icon: "x",
  category: "Workouts",
  xpReward: 10,
  unlocked: false,
  progress: 0,
  goal: 10,
  current: 0,
  ...over,
});
const server = (xp: number, achievements: Achievement[] = []) => ({
  level: 2,
  levelLabel: "Novice",
  xp,
  currentLevelXp: 100,
  nextLevelXp: 250,
  lifetimeStats: {
    sessions: 3,
    totalVolumeKg: 1000,
    bestStreak: 2,
    totalSets: 30,
    totalDistanceKm: 0,
  },
  achievements,
});

test("the level bar is the share of the way from this level to the next, never outside 0 to 1", () => {
  assert.equal(
    levelProgress({ xp: 175, currentLevelXp: 100, nextLevelXp: 250 }),
    0.5,
  );
  assert.equal(
    levelProgress({ xp: 99, currentLevelXp: 100, nextLevelXp: 250 }),
    0,
  );
  assert.equal(
    levelProgress({ xp: 9000, currentLevelXp: 8000, nextLevelXp: 8000 }),
    1,
  );
});

test("the level badge and XP bar read as the current app words them", () => {
  const rewards = {
    level: 3,
    levelLabel: "Beginner",
    xp: 1234,
    currentLevelXp: 250,
    nextLevelXp: 2000,
  };
  assert.deepEqual(levelHeadline(rewards), {
    title: "Level 3 · Beginner",
    detail: "1,234 XP total · tap for details",
    barStart: "1,234 XP",
    barEnd: "766 to next level",
  });
  assert.equal(
    levelHeadline({ ...rewards, xp: 8200, nextLevelXp: 8000 }).barEnd,
    "Max level",
  );
  assert.deepEqual(
    levelSheetHero({
      level: 3,
      xp: 400,
      currentLevelXp: 250,
      nextLevelXp: 500,
    }),
    {
      label: "Level 3 · Beginner",
      total: "400 XP total",
      start: "150 XP",
      end: "250 XP to Level 4",
    },
  );
});

test("the level ladder is the server's: eleven rungs, the labels the server awards", () => {
  assert.equal(LEVEL_THRESHOLDS.length, 11);
  const labels = LEVEL_THRESHOLDS.map((_, index) => getLevelLabel(index + 1));
  assert.deepEqual(labels, [
    "Novice",
    "Novice",
    "Beginner",
    "Beginner",
    "Intermediate",
    "Intermediate",
    "Advanced",
    "Advanced",
    "Elite",
    "Elite",
    "Legend",
  ]);
  const rows = levelRows(4);
  assert.deepEqual(
    rows.map((r) => r.state),
    [
      "past",
      "past",
      "past",
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ],
  );
  assert.equal(rows[3].threshold, 500);
});

test("XP sources list unlocked achievements by reward, largest first", () => {
  const list = [
    row("a", { unlocked: true, xpReward: 25 }),
    row("b", { unlocked: false, xpReward: 500 }),
    row("c", { unlocked: true, xpReward: 200 }),
    row("d", { unlocked: true, xpReward: 25 }),
  ];
  assert.deepEqual(
    xpSources(list).map((r) => r.id),
    ["c", "a", "d"],
  );
});

test("categories follow the current app's order and an unlisted category is not shown", () => {
  const list = [
    row("sleep", { category: "Sleep", unlocked: true }),
    row("w1", { category: "Workouts", unlocked: true }),
    row("w2", { category: "Workouts" }),
    row("steps", { category: "Steps" }),
  ];
  const groups = achievementGroups(list);
  assert.deepEqual(
    groups.map((g) => [g.category, g.unlocked, g.items.length]),
    [
      ["Workouts", 1, 2],
      ["Sleep", 1, 1],
    ],
  );
});

test("the preview is the four latest unlocks, newest first; counts cover every achievement", () => {
  const list = ["a", "b", "c", "d", "e", "f"].map((id, i) =>
    row(id, { unlocked: i !== 2 }),
  );
  assert.deepEqual(
    recentUnlocked(list).map((r) => r.id),
    ["f", "e", "d", "b"],
  );
  assert.deepEqual(achievementCounts(list), { unlocked: 5, total: 6 });
  assert.deepEqual(recentUnlocked([row("x")]), []);
});

test("a badge's tier follows its reward and only shows once unlocked", () => {
  assert.equal(getBadgeTier(49), "bronze");
  assert.equal(getBadgeTier(50), "silver");
  assert.equal(getBadgeTier(199), "silver");
  assert.equal(getBadgeTier(200), "gold");
  assert.equal(tierOf(row("a", { xpReward: 200 })), null);
  assert.equal(tierOf(row("a", { xpReward: 200, unlocked: true })), "gold");
});

test("every achievement icon the current app maps is mapped here, and an unknown id gets the dumbbell", () => {
  assert.equal(Object.keys(achievementIcons).length, 41);
  assert.equal(achievementIcon("streak_7"), "flame");
  assert.equal(achievementIcon("steps_10000"), "workout");
});

test("only unlocks not yet shown are new", () => {
  const list = [
    row("a", { unlocked: true }),
    row("b", { unlocked: true }),
    row("c"),
  ];
  assert.deepEqual(unseenUnlocks(list, ["a"]), ["b"]);
  assert.deepEqual(unseenUnlocks(list, []), ["a", "b"]);
});

test("XP earned is the server's total after minus before, and unknown when either is missing", () => {
  assert.equal(xpGained(100, 150), 50);
  assert.equal(xpGained(100, 90), 0);
  assert.equal(xpGained(null, 150), null);
  assert.equal(xpGained(100, undefined), null);
});

test("tint adds opacity to a #rrggbb colour and leaves anything else alone", () => {
  assert.equal(tint("#ff6a1a", 0.12), "#ff6a1a1f");
  assert.equal(tint("#ff6a1a", 2), "#ff6a1aff");
  assert.equal(tint("rgb(1,2,3)", 0.5), "rgb(1,2,3)");
});

function luminance(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [16, 8, 0].map((shift) => {
    const v = ((n >> shift) & 255) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("badge tier and category colours stay readable on cards in both themes", () => {
  for (const mode of ["light", "dark"] as const) {
    const theme = createTheme(mode, "green");
    const colors = [
      ...Object.values(theme.rewards.tiers),
      ...Object.values(theme.rewards.categories),
    ];
    for (const color of colors) {
      assert.ok(
        contrast(color, theme.colors.surface) >= 4.5,
        `${mode} ${color} on the sheet`,
      );
      assert.ok(
        contrast(color, theme.colors.background) >= 4.5,
        `${mode} ${color} on the screen`,
      );
    }
  }
});

// The data layer: the real WorkoutResources over real (in-memory) account storage.
async function setup(t: { after: (fn: () => void) => void }) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const state = { xp: 100, offline: false, reads: [] as string[] };
  const connect = (userId: string, offset = 0) => ({
    origin: "https://example.com",
    userId,
    timezone: null,
    get: async (path: string) => {
      state.reads.push(`${userId}:${path}`);
      if (state.offline) throw new Error("Offline");
      return server(state.xp + offset, [
        row(`${userId}-a`, { unlocked: true }),
      ]);
    },
    post: async () => ({}),
  });
  const open = (userId: string, offset = 0) =>
    new WorkoutResources(
      storage.account("https://example.com", userId),
      connect(userId, offset),
    );
  return { storage, state, open };
}

test("the reward view loads from the server and parses its XP, level and achievements", async (t) => {
  const { open, state } = await setup(t);
  const resources = open("one");
  await resources.load(achievementsSpec);
  const view = resources.state(achievementsSpec);
  assert.equal(view.data?.xp, 100);
  assert.equal(view.data?.achievements[0].id, "one-a");
  assert.deepEqual(state.reads, ["one:/api/achievements"]);
  resources.cancel();
});

test("a malformed reward answer is an error, not zero XP", async (t) => {
  const { storage } = await setup(t);
  const resources = new WorkoutResources(
    storage.account("https://example.com", "one"),
    {
      origin: "https://example.com",
      userId: "one",
      timezone: null,
      get: async () => ({ level: 2 }),
      post: async () => ({}),
    },
  );
  await resources.load(achievementsSpec);
  const view = resources.state(achievementsSpec);
  assert.equal(view.data, null);
  assert.ok(view.error);
  resources.cancel();
});

test("saved rewards are one account's: another account never sees them, offline or not", async (t) => {
  const { open, state } = await setup(t);
  const first = open("one");
  await first.load(achievementsSpec);
  first.cancel();
  state.offline = true;
  const again = open("one");
  await again.load(achievementsSpec);
  assert.equal(
    again.state(achievementsSpec).data?.xp,
    100,
    "the owner sees the saved view offline",
  );
  again.cancel();
  const other = open("two", 5);
  await other.load(achievementsSpec);
  assert.equal(
    other.state(achievementsSpec).data,
    null,
    "a second account has nothing saved",
  );
  state.offline = false;
  await other.load(achievementsSpec, true);
  assert.equal(other.state(achievementsSpec).data?.xp, 105);
  assert.equal(other.state(achievementsSpec).data?.achievements[0].id, "two-a");
  other.cancel();
});

test("each write that can unlock something expires the reward view; an unrelated one does not", async (t) => {
  for (const path of [
    "/api/workout-data",
    "/api/exercise-history",
    "/api/personal-records",
    "/api/streak-data",
    "/api/day-log",
    "/api/sleep-sessions",
    "/api/activity-logs",
    "/api/weights-summary",
    "/api/body-metadata",
    "/api/nutrition/energy-balance",
  ])
    await t.test(path, async (t) => {
      const { open, state } = await setup(t);
      const resources = open("one");
      await resources.load(achievementsSpec);
      await resources.load(achievementsSpec);
      assert.equal(state.reads.length, 1, "fresh within its lifetime");
      resources.invalidate([path]);
      await resources.load(achievementsSpec);
      assert.equal(state.reads.length, 2, "refetched after the write");
      resources.cancel();
    });
  const { open, state } = await setup(t);
  const resources = open("one");
  await resources.load(achievementsSpec);
  resources.invalidate(["/api/weather", "/api/user/profile"]);
  await resources.load(achievementsSpec);
  assert.equal(state.reads.length, 1);
  resources.cancel();
});

test("an uploaded workout expires the persisted reward view even after a restart", async (t) => {
  const { open, state } = await setup(t);
  await open("one").load(achievementsSpec);
  await open("one").write("POST", "/api/sync/push", {}, [
    "/api/workout-data",
    "/api/streak-data",
  ]);
  state.xp = 150;
  const restarted = open("one");
  await restarted.load(achievementsSpec);
  assert.equal(restarted.state(achievementsSpec).data?.xp, 150);
  restarted.cancel();
});

test("invalidation does not add the reward view twice", () => {
  assert.deepEqual(withRewardState(["/api/workout-data"]), [
    "/api/workout-data",
    "/api/achievements",
  ]);
  assert.deepEqual(withRewardState(["/api/achievements", "/api/day-log"]), [
    "/api/achievements",
    "/api/day-log",
  ]);
  assert.deepEqual(withRewardState(["/api/weather"]), ["/api/weather"]);
});

test("XP earned: the baseline is a settled server total, the gain is measured after the upload", async (t) => {
  const { open, state } = await setup(t);
  const resources = open("one");
  assert.equal(
    settledXp(resources.state(achievementsSpec)),
    null,
    "nothing read yet",
  );
  await resources.load(achievementsSpec);
  const before = settledXp(resources.state(achievementsSpec));
  assert.equal(before, 100);
  // The workout uploads: the server pays 40 XP and the upload invalidates the view.
  state.xp = 140;
  resources.invalidate(["/api/workout-data", "/api/streak-data"]);
  assert.equal(await earnedXp(resources, before!), 40);
  resources.cancel();
});

test("XP earned is unknown, not zero, when the refresh after the workout fails", async (t) => {
  const { open, state } = await setup(t);
  const resources = open("one");
  await resources.load(achievementsSpec);
  state.offline = true;
  assert.equal(await earnedXp(resources, 100), null);
  assert.equal(
    settledXp(resources.state(achievementsSpec)),
    null,
    "a stale view is not a baseline",
  );
  resources.cancel();
});

test("seen unlocks are kept per account and a damaged record reads as none", async (t) => {
  const { storage } = await setup(t);
  const one = storage.account("https://example.com", "one");
  const two = storage.account("https://example.com", "two");
  assert.deepEqual(await readSeen(one), []);
  assert.deepEqual(await markSeen(one, [], ["a", "b"]), ["a", "b"]);
  assert.deepEqual(await markSeen(one, ["a", "b"], ["b", "c"]), [
    "a",
    "b",
    "c",
  ]);
  assert.deepEqual(await readSeen(one), ["a", "b", "c"]);
  assert.deepEqual(await readSeen(two), []);
  await two.set("seen-achievements.v1", "{not json");
  assert.deepEqual(await readSeen(two), []);
  await two.set("seen-achievements.v1", JSON.stringify({ a: 1 }));
  assert.deepEqual(await readSeen(two), []);
});

test("the reward schema accepts what the server sends and keeps the lifetime stats More shows", () => {
  const parsed = z
    .object({ lifetimeStats: z.object({ sessions: z.number() }) })
    .parse(server(0));
  assert.equal(parsed.lifetimeStats.sessions, 3);
  assert.equal(
    achievementsSpec.schema.parse(server(0, [row("a")])).achievements.length,
    1,
  );
});

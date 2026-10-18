import assert from "node:assert/strict";
import { test } from "node:test";
import {
  batteryColor,
  dayTotalFigures,
  foodLine,
  portionKcalLine,
  recipeCountLine,
  signedKcal,
} from "../src/features/nutrition/data/display.ts";
import { deleteSupplement } from "../src/features/nutrition/data/supplement-delete.ts";
import { stageValue } from "../src/features/health/data/stage-value.ts";
import { recordedIntake } from "../src/features/nutrition/data/recorded-intake.ts";

test("a food line skips a missing brand and groups thousands", () => {
  assert.equal(foodLine(null, 125, 80), "125 g · 80 kcal");
  assert.equal(
    foodLine("  Brand ", 30, 1250),
    `Brand · 30 g · ${(1250).toLocaleString()} kcal`,
  );
});

test("portion and recipe lines use the singular for one", () => {
  assert.equal(portionKcalLine(1, 400), "1 portion · 400 kcal per portion");
  assert.equal(portionKcalLine(4, 2000), "4 portions · 500 kcal per portion");
  assert.equal(recipeCountLine(1, 1), "1 ingredient · 1 portion");
  assert.equal(recipeCountLine(5, 2), "5 ingredients · 2 portions");
});

test("energy balance signs: surplus +, deficit a real minus, zero none", () => {
  assert.equal(signedKcal(300), "+300");
  assert.equal(signedKcal(-300), "−300");
  assert.equal(signedKcal(0), "0");
});

test("sleep stages read as hours and minutes", () => {
  assert.equal(stageValue(1 + 5 / 60, "h"), "1h 05m");
  assert.equal(stageValue(null, "h"), "—");
});

test("End of Day uses the counted intake, not just logged food", () => {
  const counted = recordedIntake({
    calories: 1000,
    hasLogs: true,
    pending: false,
    allSkipped: false,
    loggedMealTypeIds: ["breakfast"],
    balance: {
      budgetKcal: 2000,
      estimatedMeals: [{ mealTypeId: "dinner", kcal: 600 }],
    },
  });
  const f = dayTotalFigures({
    loggedKcal: 1000,
    intake: counted.intake,
    remaining: counted.remaining,
    budget: 2000,
  });
  assert.equal(counted.intake, 1600);
  assert.equal(f.calories, 1600);
  assert.equal(f.remaining, 400);
  assert.equal(f.fraction, 0.8);
});

test("End of Day falls back to logged food and shows no denominator without a budget", () => {
  const f = dayTotalFigures({
    loggedKcal: 900,
    intake: null,
    remaining: null,
    budget: null,
  });
  assert.deepEqual(f, {
    calories: 900,
    budget: null,
    remaining: null,
    fraction: null,
  });
  assert.equal(
    dayTotalFigures({
      loggedKcal: 2500,
      intake: 2500,
      remaining: -500,
      budget: 2000,
    }).remaining,
    0,
  );
});

test("the Body Battery pill takes theme colours, never CSS variables", () => {
  const theme = {
    colors: { danger: "#d00" },
    tones: {
      checkin: { foreground: "#fa0" },
    },
    status: { success: "#0a0" },
  };
  assert.equal(batteryColor("Drained", theme), "#d00");
  assert.equal(batteryColor("Low", theme), "#fa0");
  assert.equal(batteryColor("Good", theme), "#0a0");
  assert.equal(batteryColor("Charged", theme), "#0a0");
});

test("deleting a supplement clears its edit draft, and a failed delete keeps it", async () => {
  const calls: string[] = [];
  await deleteSupplement(
    {
      enqueue: async (ops) => void calls.push(`enqueue:${ops[0].payload.id}`),
      clearDraft: async (key) => void calls.push(`clear:${key}`),
    },
    "2026-10-17",
    "s1",
  );
  assert.deepEqual(calls, ["enqueue:s1", "clear:supplement-editor:s1"]);
  const failed: string[] = [];
  await assert.rejects(
    deleteSupplement(
      {
        enqueue: async () => {
          throw new Error("offline");
        },
        clearDraft: async (key) => void failed.push(key),
      },
      "2026-10-17",
      "s1",
    ),
  );
  assert.deepEqual(failed, []);
});

import { describe, it, expect } from "vitest";
import { injurySafeAlternatives } from "../injury-substitution";

const LIB = [
  { name: "Bench Press", muscles: [{ muscle: "chest", role: "main" }, { muscle: "triceps", role: "secondary" }], equipment: ["barbell"] },
  { name: "Machine Chest Press", muscles: [{ muscle: "chest", role: "main" }], equipment: ["machine"] },
  { name: "Overhead Press", muscles: [{ muscle: "shoulders", role: "main" }, { muscle: "triceps", role: "secondary" }], equipment: ["barbell"] },
  { name: "Push-Up", muscles: [{ muscle: "chest", role: "main" }, { muscle: "shoulders", role: "secondary" }], equipment: [] },
];

describe("injurySafeAlternatives", () => {
  it("offers same-main-muscle candidates that avoid the injured muscle", () => {
    const alts = injurySafeAlternatives(
      { name: "Bench Press", mainMuscles: ["chest"] },
      ["shoulders"],
      LIB,
    );
    expect(alts.map(a => a.name)).toEqual(["Machine Chest Press"]);
  });
  it("returns empty when every main muscle of the original is injured", () => {
    const alts = injurySafeAlternatives({ name: "Bench Press", mainMuscles: ["chest"] }, ["chest"], LIB);
    expect(alts).toEqual([]);
  });
  it("is case-insensitive on muscle names", () => {
    const alts = injurySafeAlternatives({ name: "Bench Press", mainMuscles: ["Chest"] }, ["SHOULDERS"], LIB);
    expect(alts.map(a => a.name)).toEqual(["Machine Chest Press"]);
  });
});

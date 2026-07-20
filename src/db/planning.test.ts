import { describe, expect, it } from "vitest";

import { getMealPlanItemContext, parsePlannedServings, resolvePlannedServingUpdate, shiftPlannedDate } from "./planning";

describe("meal plan week copying", () => {
  it("preserves each weekday when copying to a later week", () => {
    expect(shiftPlannedDate("2026-07-13", "2026-07-13", "2026-07-20")).toBe("2026-07-20");
    expect(shiftPlannedDate("2026-07-19", "2026-07-13", "2026-07-20")).toBe("2026-07-26");
  });

  it("supports copying across a year boundary", () => {
    expect(shiftPlannedDate("2025-12-31", "2025-12-29", "2026-01-05")).toBe("2026-01-07");
  });

  it("rejects source items outside the source week", () => {
    expect(() => shiftPlannedDate("2026-07-20", "2026-07-13", "2026-07-20")).toThrow("outside the source week");
  });
});

describe("meal plan servings", () => {
  it("accepts fractional family servings", () => {
    expect(parsePlannedServings("2.5")).toBe(2.5);
    expect(parsePlannedServings(0.25)).toBe(0.25);
  });

  it("rejects invalid and excessive values", () => {
    expect(() => parsePlannedServings(0)).toThrow("between");
    expect(() => parsePlannedServings(101)).toThrow("between");
    expect(() => parsePlannedServings("many")).toThrow("between");
  });

  it("adjusts planned servings with bounded whole and fractional steps", () => {
    expect(resolvePlannedServingUpdate(8, null, "decrease")).toBe(7);
    expect(resolvePlannedServingUpdate(8, null, "increase")).toBe(9);
    expect(resolvePlannedServingUpdate(0.5, null, "decrease")).toBe(0.25);
    expect(resolvePlannedServingUpdate(0.75, null, "increase")).toBe(1);
    expect(resolvePlannedServingUpdate(100, null, "increase")).toBe(100);
    expect(resolvePlannedServingUpdate(4, "6.5", "manual")).toBe(6.5);
  });
});

describe("meal plan recipe context", () => {
  it("resolves an item with its plan only through household and recipe scope", async () => {
    let bindings: unknown[] = [];
    const db = {
      prepare() {
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return {
              async first() {
                return {
                  item_id: "item-1",
                  plan_id: "plan-1",
                  plan_name: "Week of 2026-07-20",
                  starts_on: "2026-07-20",
                  ends_on: "2026-07-26",
                  recipe_id: "recipe-1",
                  planned_date: "2026-07-23",
                  meal_slot: "dinner",
                  servings: "7.5",
                };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    await expect(getMealPlanItemContext(db, "household-1", "item-1", "recipe-1")).resolves.toMatchObject({
      itemId: "item-1",
      planId: "plan-1",
      servings: 7.5,
    });
    expect(bindings).toEqual(["item-1", "recipe-1", "household-1"]);
  });
});

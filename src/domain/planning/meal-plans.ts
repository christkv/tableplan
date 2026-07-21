import { addDays } from "./dates";

export interface MealPlanItemView { id: string; recipeId: string; recipeName: string; plannedDate: string; mealSlot: string; servings: number; notes: string | null }
export interface MealPlanView { id: string; name: string; startsOn: string; endsOn: string; items: MealPlanItemView[] }
export interface MealPlanItemContext { itemId: string; planId: string; planName: string; startsOn: string; endsOn: string; recipeId: string; plannedDate: string; mealSlot: string; servings: number }

export function parsePlannedServings(value: unknown): number {
  const servings = Number(value);
  if (!Number.isFinite(servings) || servings < 0.25 || servings > 100) throw new Error("Servings must be between 0.25 and 100");
  return servings;
}

export function resolvePlannedServingUpdate(currentValue: unknown, requestedValue: unknown, adjustment: unknown): number {
  const current = parsePlannedServings(currentValue);
  if (adjustment === "decrease") return Math.max(0.25, current - (current < 1 ? 0.25 : 1));
  if (adjustment === "increase") return Math.min(100, current + (current < 1 ? 0.25 : 1));
  return parsePlannedServings(requestedValue);
}

export class MealPlanCopyError extends Error {
  constructor(public readonly code: "source_empty" | "target_not_empty", message: string) { super(message); this.name = "MealPlanCopyError"; }
}

export function shiftPlannedDate(plannedDate: string, sourceStartsOn: string, targetStartsOn: string): string {
  const source = new Date(`${sourceStartsOn}T00:00:00Z`); const date = new Date(`${plannedDate}T00:00:00Z`);
  const dayOffset = Math.round((date.getTime() - source.getTime()) / 86_400_000);
  if (!Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset > 6) throw new Error("Plan item date is outside the source week");
  return addDays(targetStartsOn, dayOffset);
}

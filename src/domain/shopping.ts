import type { MeasurementSystem } from "./quantity/types";

export interface ShoppingItemView {
  id: string; name: string; quantityMin: string | null; quantityMax: string | null; unitId: string | null;
  checked: boolean; unresolved: boolean; sources: Array<{ recipeId: string; recipeName: string; rawLine: string }>;
}
export interface ShoppingListPlanView { id: string; name: string; startsOn: string; endsOn: string; mealCount: number }
export interface ShoppingListView {
  id: string; name: string; measurementSystem: MeasurementSystem; generatedAt: string; updatedAt: string;
  plan: ShoppingListPlanView | null; items: ShoppingItemView[];
}

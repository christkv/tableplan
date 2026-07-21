import type { StorageClient } from "./contract";

const shadowReadMethods = new Set<keyof StorageClient>([
  "searchRecipes", "listRecipeTagFacets", "getRecipe", "isFavorite", "listFavorites", "getMeasurementSystem", "getMealPlanSlots",
  "listSavedRecipeSearches", "getMealPlan", "getMealPlanById", "getMealPlanItemContext", "getLatestShoppingList", "getShoppingListById",
  "getShoppingListForPlan", "listShoppingShares", "getPublicShoppingList", "listApiKeys", "getRecipeIngestion", "getRecipeSourceArtifact",
  "listIngredientCandidates", "getUserEmail", "getHouseholdOverview", "resolveHouseholdInvitation", "getEmailDelivery",
]);

export interface ShadowReadEvent { operation: string; outcome: "match" | "mismatch" | "shadow_error"; durationMs: number }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function createShadowReadClient(primary: StorageClient, shadow: StorageClient, report: (event: ShadowReadEvent) => void = (event) => console.warn(JSON.stringify({ event: "storage.shadow", ...event }))): StorageClient {
  return new Proxy(primary, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || typeof value !== "function" || !shadowReadMethods.has(property as keyof StorageClient)) return typeof value === "function" ? value.bind(target) : value;
      return async (...args: unknown[]) => {
        const startedAt = performance.now();
        const primaryCall = Reflect.apply(value, target, args) as Promise<unknown>;
        const shadowMethod = Reflect.get(shadow, property) as (...input: unknown[]) => Promise<unknown>;
        const [primaryResult, shadowResult] = await Promise.allSettled([primaryCall, Reflect.apply(shadowMethod, shadow, args)]);
        if (primaryResult.status === "rejected") throw primaryResult.reason;
        const durationMs = performance.now() - startedAt;
        if (shadowResult.status === "rejected") report({ operation: property, outcome: "shadow_error", durationMs });
        else report({ operation: property, outcome: canonical(primaryResult.value) === canonical(shadowResult.value) ? "match" : "mismatch", durationMs });
        return primaryResult.value;
      };
    },
  });
}

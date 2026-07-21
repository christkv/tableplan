import type { Route } from "./+types/api.meal-plan-item";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { parsePlannedServings } from "../../src/domain/planning/meal-plans";
import { createStorageClient } from "../../src/storage";

export async function action({ params, request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "plans:write");
  if (access instanceof Response) return access;
  try {
    const body = await request.json<{ servings?: unknown }>();
    const servings = parsePlannedServings(body.servings);
    const storage = createStorageClient(env);
    const planId = await storage.updateMealPlanItemServings({ householdId: access.householdId, userId: access.userId, itemId: params.itemId, servings });
    const shoppingListId = await storage.refreshShoppingListForPlan(access, planId);
    return Response.json({ itemId: params.itemId, planId, servings, shoppingListId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meal plan item could not be updated";
    return Response.json({ code: message.includes("not found") ? "plan_item_not_found" : "invalid_servings", message }, { status: message.includes("not found") ? 404 : 400 });
  }
}

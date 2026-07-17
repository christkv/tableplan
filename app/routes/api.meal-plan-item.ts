import type { Route } from "./+types/api.meal-plan-item";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { parsePlannedServings, updateMealPlanItemServings } from "../../src/db/planning";
import { refreshShoppingListForPlan } from "../../src/db/shopping";

export async function action({ params, request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "plans:write");
  if (access instanceof Response) return access;
  try {
    const body = await request.json<{ servings?: unknown }>();
    const servings = parsePlannedServings(body.servings);
    const planId = await updateMealPlanItemServings(env.DB, { householdId: access.householdId, itemId: params.itemId, servings });
    const shoppingListId = await refreshShoppingListForPlan(env.DB, access.householdId, planId);
    return Response.json({ itemId: params.itemId, planId, servings, shoppingListId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meal plan item could not be updated";
    return Response.json({ code: message.includes("not found") ? "plan_item_not_found" : "invalid_servings", message }, { status: message.includes("not found") ? 404 : 400 });
  }
}

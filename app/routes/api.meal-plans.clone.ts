import type { Route } from "./+types/api.meal-plans.clone";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { addDays, startOfIsoWeek } from "../../src/domain/planning/dates";
import { copyMealPlanWeek, MealPlanCopyError } from "../../src/db/planning";
import { refreshShoppingListForPlan } from "../../src/db/shopping";

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "plans:write");
  if (access instanceof Response) return access;
  try {
    const body = await request.json<{ targetWeek: string }>();
    const targetStartsOn = startOfIsoWeek(body.targetWeek);
    const copied = await copyMealPlanWeek(env.DB, {
      householdId: access.householdId,
      userId: access.userId,
      sourceStartsOn: addDays(targetStartsOn, -7),
      targetStartsOn,
      timezone: "UTC",
    });
    await refreshShoppingListForPlan(env.DB, access.householdId, copied.planId);
    return Response.json({ ...copied, week: targetStartsOn }, { status: 201 });
  } catch (error) {
    if (error instanceof MealPlanCopyError) return Response.json({ code: error.code, message: error.message }, { status: 409 });
    return Response.json({ code: "invalid_week", message: error instanceof Error ? error.message : "Invalid target week" }, { status: 400 });
  }
}

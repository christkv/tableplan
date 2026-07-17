import type { Route } from "./+types/api.meal-plans";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { addDays, startOfIsoWeek, weekDates } from "../../src/domain/planning/dates";
import { addMealPlanItem, ensureMealPlan, getMealPlan, parsePlannedServings } from "../../src/db/planning";
import { getMealPlanSlots } from "../../src/db/preferences";
import { refreshShoppingListForPlan } from "../../src/db/shopping";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "plans:read");
  if (access instanceof Response) return access;
  const start = startOfIsoWeek(new URL(request.url).searchParams.get("week") ?? new Date());
  const [plan, mealSlots] = await Promise.all([
    getMealPlan(env.DB, access.householdId, start, addDays(start, 6)),
    getMealPlanSlots(env.DB, access.householdId),
  ]);
  return Response.json({ plan, week: start, mealSlots });
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "plans:write");
  if (access instanceof Response) return access;
  const body = await request.json<{ week: string; recipeId: string; date: string; slot: string; servings: number }>();
  const start = startOfIsoWeek(body.week);
  if (!weekDates(start).includes(body.date)) return Response.json({ code: "invalid_plan_item", message: "Date is outside the requested week" }, { status: 400 });
  const mealSlots = await getMealPlanSlots(env.DB, access.householdId);
  if (!mealSlots.some((slot) => slot.id === body.slot)) return Response.json({ code: "invalid_plan_item", message: "Meal section is not configured for this household" }, { status: 400 });
  let servings: number;
  try { servings = parsePlannedServings(body.servings); }
  catch (error) { return Response.json({ code: "invalid_plan_item", message: error instanceof Error ? error.message : "Servings are invalid" }, { status: 400 }); }
  const planId = await ensureMealPlan(env.DB, { householdId: access.householdId, startsOn: start, endsOn: addDays(start, 6), timezone: "UTC", userId: access.userId });
  try {
    const itemId = await addMealPlanItem(env.DB, { householdId: access.householdId, planId, recipeId: body.recipeId, date: body.date, slot: body.slot, servings });
    await refreshShoppingListForPlan(env.DB, access.householdId, planId);
    return Response.json({ planId, itemId }, { status: 201 });
  } catch (error) {
    return Response.json({ code: "recipe_not_shareable", message: error instanceof Error ? error.message : "Recipe cannot be planned" }, { status: 409 });
  }
}

import type { Route } from "./+types/api.meal-plans";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { addDays, startOfIsoWeek, weekDates } from "../../src/domain/planning/dates";
import { parsePlannedServings } from "../../src/domain/planning/meal-plans";
import { createStorageClient } from "../../src/storage";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "plans:read");
  if (access instanceof Response) return access;
  const start = startOfIsoWeek(new URL(request.url).searchParams.get("week") ?? new Date());
  const [plan, mealSlots] = await Promise.all([
    createStorageClient(env).getMealPlan(access, start, addDays(start, 6)),
    createStorageClient(env).getMealPlanSlots(access),
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
  const mealSlots = await createStorageClient(env).getMealPlanSlots(access);
  if (!mealSlots.some((slot) => slot.id === body.slot)) return Response.json({ code: "invalid_plan_item", message: "Meal section is not configured for this household" }, { status: 400 });
  let servings: number;
  try { servings = parsePlannedServings(body.servings); }
  catch (error) { return Response.json({ code: "invalid_plan_item", message: error instanceof Error ? error.message : "Servings are invalid" }, { status: 400 }); }
  const storage = createStorageClient(env);
  const planId = await storage.ensureMealPlan({ householdId: access.householdId, startsOn: start, endsOn: addDays(start, 6), timezone: "UTC", userId: access.userId });
  try {
    const itemId = await storage.addMealPlanItem({ householdId: access.householdId, userId: access.userId, planId, recipeId: body.recipeId, date: body.date, slot: body.slot, servings });
    await storage.refreshShoppingListForPlan(access, planId);
    return Response.json({ planId, itemId }, { status: 201 });
  } catch (error) {
    return Response.json({ code: "recipe_not_shareable", message: error instanceof Error ? error.message : "Recipe cannot be planned" }, { status: 409 });
  }
}

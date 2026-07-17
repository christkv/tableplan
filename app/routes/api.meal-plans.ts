import type { Route } from "./+types/api.meal-plans";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { addDays, startOfIsoWeek, weekDates } from "../../src/domain/planning/dates";
import { addMealPlanItem, ensureMealPlan, getMealPlan } from "../../src/db/planning";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "plans:read");
  if (access instanceof Response) return access;
  const start = startOfIsoWeek(new URL(request.url).searchParams.get("week") ?? new Date());
  return Response.json({ plan: await getMealPlan(env.DB, access.householdId, start, addDays(start, 6)), week: start });
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "plans:write");
  if (access instanceof Response) return access;
  const body = await request.json<{ week: string; recipeId: string; date: string; slot: string; servings: number }>();
  const start = startOfIsoWeek(body.week);
  if (!weekDates(start).includes(body.date) || !Number.isFinite(body.servings) || body.servings <= 0) return Response.json({ code: "invalid_plan_item", message: "Date or servings are invalid" }, { status: 400 });
  const planId = await ensureMealPlan(env.DB, { householdId: access.householdId, startsOn: start, endsOn: addDays(start, 6), timezone: "UTC", userId: access.userId });
  const itemId = await addMealPlanItem(env.DB, { planId, recipeId: body.recipeId, date: body.date, slot: body.slot, servings: body.servings });
  return Response.json({ planId, itemId }, { status: 201 });
}

import { CalendarDays, Check, ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/plan";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cloudflareContext } from "../context";
import { requireRequestSession } from "../../src/auth/server";
import { addDays, startOfIsoWeek, weekDates } from "../../src/domain/planning/dates";
import { getRecipe } from "../../src/db/recipes";
import { addMealPlanItem, copyMealPlanWeek, ensureMealPlan, getMealPlan, removeMealPlanItem } from "../../src/db/planning";

const slots = ["breakfast", "lunch", "dinner"];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const url = new URL(request.url);
  const start = startOfIsoWeek(url.searchParams.get("week") ?? new Date());
  const end = addDays(start, 6);
  const previousStart = addDays(start, -7);
  const addRecipeId = url.searchParams.get("add");
  const [plan, previousPlan, addRecipe] = await Promise.all([
    getMealPlan(env.DB, session.householdId, start, end),
    getMealPlan(env.DB, session.householdId, previousStart, addDays(previousStart, 6)),
    addRecipeId ? getRecipe(env.DB, addRecipeId) : null,
  ]);
  return {
    start,
    end,
    dates: weekDates(start),
    plan,
    previousPlan,
    addRecipe,
    clonedCount: Number(url.searchParams.get("cloned") ?? 0),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const data = await request.formData();
  const start = startOfIsoWeek(String(data.get("week")));
  if (data.get("intent") === "copy-previous") {
    const copied = await copyMealPlanWeek(env.DB, {
      householdId: session.householdId,
      userId: session.user.id,
      sourceStartsOn: addDays(start, -7),
      targetStartsOn: start,
      timezone: "UTC",
    });
    return redirect(`/plan?week=${start}&cloned=${copied.itemCount}`);
  } else if (data.get("intent") === "remove") {
    await removeMealPlanItem(env.DB, session.householdId, String(data.get("itemId")));
  } else {
    const date = String(data.get("date"));
    if (!weekDates(start).includes(date)) throw new Response("Date is outside this week", { status: 400 });
    const servings = Number(data.get("servings"));
    if (!Number.isFinite(servings) || servings <= 0 || servings > 100) throw new Response("Invalid servings", { status: 400 });
    const planId = await ensureMealPlan(env.DB, { householdId: session.householdId, startsOn: start, endsOn: addDays(start, 6), timezone: "UTC", userId: session.user.id });
    await addMealPlanItem(env.DB, { planId, recipeId: String(data.get("recipeId")), date, slot: String(data.get("slot")), servings });
  }
  return redirect(`/plan?week=${start}`);
}

const dayLabel = (date: string) => new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

export default function Plan({ loaderData }: Route.ComponentProps) {
  const items = loaderData.plan?.items ?? [];
  return (
    <div className="page-shell plan-page">
      <header className="page-header"><div><p className="eyebrow">Weekly rhythm</p><h1>Meal plan</h1><p className="page-subtitle">{loaderData.start} to {loaderData.end}</p></div><div className="header-actions"><Link className="button button-secondary button-icon" aria-label="Previous week" to={`/plan?week=${addDays(loaderData.start, -7)}`}><ChevronLeft size={18} /></Link><Link className="button button-secondary button-default" to="/plan">This week</Link><Link className="button button-secondary button-icon" aria-label="Next week" to={`/plan?week=${addDays(loaderData.start, 7)}`}><ChevronRight size={18} /></Link></div></header>
      {!items.length ? <section className="plan-copy">
        <div><Copy size={19} /><div><h2>Start from last week</h2><p>{loaderData.previousPlan?.items.length ? `Copy ${loaderData.previousPlan.items.length} planned meal${loaderData.previousPlan.items.length === 1 ? "" : "s"}, then add or remove anything for this week.` : "The previous week has no planned meals to copy."}</p></div></div>
        <Form method="post"><input type="hidden" name="week" value={loaderData.start} /><Button name="intent" value="copy-previous" variant="secondary" disabled={!loaderData.previousPlan?.items.length}><Copy size={16} /> Copy previous week</Button></Form>
      </section> : null}
      {loaderData.clonedCount > 0 ? <div className="plan-copy-success" role="status"><Check size={16} /> Copied {loaderData.clonedCount} meal{loaderData.clonedCount === 1 ? "" : "s"} from the previous week.</div> : null}
      {loaderData.addRecipe ? <section className="plan-add"><div><p className="eyebrow">Add recipe</p><h2>{loaderData.addRecipe.name}</h2></div><Form method="post"><input type="hidden" name="week" value={loaderData.start} /><input type="hidden" name="recipeId" value={loaderData.addRecipe.id} /><label>Date<select name="date">{loaderData.dates.map((date) => <option key={date} value={date}>{dayLabel(date)}</option>)}</select></label><label>Slot<select name="slot">{slots.map((slot) => <option key={slot}>{slot}</option>)}</select></label><label>Servings<Input name="servings" type="number" min="1" max="100" defaultValue={loaderData.addRecipe.servings ?? 4} /></label><Button type="submit"><Plus size={17} /> Add</Button></Form></section> : null}
      <div className="week-grid"><div className="week-corner"><CalendarDays size={18} /></div>{loaderData.dates.map((date) => <div className="day-heading" key={date}>{dayLabel(date)}</div>)}{slots.map((slot) => <div className="week-row" key={slot}><div className="slot-heading">{slot}</div>{loaderData.dates.map((date) => { const dayItems = items.filter((item) => item.plannedDate === date && item.mealSlot === slot); return <div className="meal-slot-cell" key={`${date}-${slot}`}>{dayItems.map((item) => <article className="planned-meal" key={item.id}><Link to={`/recipes/${item.recipeId}`}>{item.recipeName}</Link><span>{item.servings} servings</span><Form method="post"><input type="hidden" name="week" value={loaderData.start} /><input type="hidden" name="itemId" value={item.id} /><button name="intent" value="remove" aria-label={`Remove ${item.recipeName}`}><Trash2 size={14} /></button></Form></article>)}<Link className="meal-slot-add" to="/recipes"><Plus size={15} /><span>Add</span></Link></div>; })}</div>)}</div>
      {loaderData.plan ? <div className="plan-footer"><Link className="button button-primary button-default" to={`/shopping?plan=${loaderData.plan.id}&week=${loaderData.start}`}>Build shopping list</Link></div> : null}
    </div>
  );
}

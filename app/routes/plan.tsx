import { CalendarDays, Check, ChevronLeft, ChevronRight, Copy, FileDown, Files, Plus, Trash2 } from "lucide-react";
import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/plan";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cloudflareContext } from "../context";
import { requireRequestSession } from "../../src/auth/server";
import { addDays, startOfIsoWeek, weekDates } from "../../src/domain/planning/dates";
import { withMealPlanSelection } from "../../src/domain/planning/selection";
import { getRecipe } from "../../src/db/recipes";
import { getMealPlanSlots } from "../../src/db/preferences";
import { addMealPlanItem, copyMealPlanWeek, ensureMealPlan, getMealPlan, parsePlannedServings, removeMealPlanItem, updateMealPlanItemServings } from "../../src/db/planning";
import { refreshShoppingListForPlan } from "../../src/db/shopping";

const legacySlotLabel = (id: string) => id.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const url = new URL(request.url);
  const start = startOfIsoWeek(url.searchParams.get("week") ?? new Date());
  const end = addDays(start, 6);
  const dates = weekDates(start);
  const previousStart = addDays(start, -7);
  const addRecipeId = url.searchParams.get("add");
  const requestedServings = Number(url.searchParams.get("servings"));
  const requestedDate = url.searchParams.get("date");
  const requestedSlot = url.searchParams.get("slot");
  const [plan, previousPlan, addRecipe, configuredSlots] = await Promise.all([
    getMealPlan(env.DB, session.householdId, start, end),
    getMealPlan(env.DB, session.householdId, previousStart, addDays(previousStart, 6)),
    addRecipeId ? getRecipe(env.DB, addRecipeId, { userId: session.user.id, householdId: session.householdId }) : null,
    getMealPlanSlots(env.DB, session.householdId),
  ]);
  const configuredIds = new Set(configuredSlots.map((slot) => slot.id));
  const legacySlots = [...new Set((plan?.items ?? []).map((item) => item.mealSlot))]
    .filter((id) => !configuredIds.has(id)).map((id) => ({ id, label: legacySlotLabel(id), active: false }));
  const slots = [...configuredSlots.map((slot) => ({ ...slot, active: true })), ...legacySlots];
  return {
    start,
    end,
    dates,
    plan,
    previousPlan,
    addRecipe,
    addDate: requestedDate && dates.includes(requestedDate) ? requestedDate : dates[0],
    slots,
    addSlot: requestedSlot && configuredIds.has(requestedSlot) ? requestedSlot : configuredSlots[0].id,
    addServings: Number.isFinite(requestedServings) && requestedServings > 0 && requestedServings <= 1_000 ? requestedServings : null,
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
    await refreshShoppingListForPlan(env.DB, session.householdId, copied.planId);
    return redirect(`/plan?week=${start}&cloned=${copied.itemCount}`);
  } else if (data.get("intent") === "remove") {
    const planId = await removeMealPlanItem(env.DB, session.householdId, String(data.get("itemId")));
    if (planId) await refreshShoppingListForPlan(env.DB, session.householdId, planId);
  } else if (data.get("intent") === "update-servings") {
    const planId = await updateMealPlanItemServings(env.DB, { householdId: session.householdId, itemId: String(data.get("itemId")), servings: parsePlannedServings(data.get("servings")) });
    await refreshShoppingListForPlan(env.DB, session.householdId, planId);
  } else {
    const date = String(data.get("date"));
    if (!weekDates(start).includes(date)) throw new Response("Date is outside this week", { status: 400 });
    const slot = String(data.get("slot"));
    const configuredSlots = await getMealPlanSlots(env.DB, session.householdId);
    if (!configuredSlots.some((definition) => definition.id === slot)) throw new Response("Meal section is not configured for this household", { status: 400 });
    const servings = parsePlannedServings(data.get("servings"));
    const recipe = await getRecipe(env.DB, String(data.get("recipeId")), { userId: session.user.id, householdId: session.householdId });
    if (!recipe) throw new Response("Recipe not found", { status: 404 });
    if (recipe.visibility === "user_private") throw new Response("Share this recipe with the household before adding it to a meal plan", { status: 409 });
    const planId = await ensureMealPlan(env.DB, { householdId: session.householdId, startsOn: start, endsOn: addDays(start, 6), timezone: "UTC", userId: session.user.id });
    await addMealPlanItem(env.DB, { householdId: session.householdId, planId, recipeId: String(data.get("recipeId")), date, slot, servings });
    await refreshShoppingListForPlan(env.DB, session.householdId, planId);
  }
  return redirect(`/plan?week=${start}`);
}

const dayLabel = (date: string) => new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

export default function Plan({ loaderData }: Route.ComponentProps) {
  const items = loaderData.plan?.items ?? [];
  return (
    <div className="page-shell plan-page">
      <header className="page-header"><div><p className="eyebrow">Weekly rhythm</p><h1>Meal plan</h1><p className="page-subtitle">{loaderData.start} to {loaderData.end}</p></div><div className="header-actions">{loaderData.plan ? <><a className="button button-secondary button-icon" title="Download meal plan PDF" aria-label="Download meal plan PDF" target="_blank" rel="noreferrer" href={`/api/v1/meal-plans/${loaderData.plan.id}/pdf`}><FileDown size={18} /></a><a className="button button-secondary button-icon" title="Download meal plan and shopping list PDF" aria-label="Download meal plan and shopping list PDF" target="_blank" rel="noreferrer" href={`/api/v1/meal-plans/${loaderData.plan.id}/combined.pdf`}><Files size={18} /></a></> : null}<Link className="button button-secondary button-icon" aria-label="Previous week" to={`/plan?week=${addDays(loaderData.start, -7)}`}><ChevronLeft size={18} /></Link><Link className="button button-secondary button-default" to="/plan">This week</Link><Link className="button button-secondary button-icon" aria-label="Next week" to={`/plan?week=${addDays(loaderData.start, 7)}`}><ChevronRight size={18} /></Link></div></header>
      {!items.length ? <section className="plan-copy">
        <div><Copy size={19} /><div><h2>Start from last week</h2><p>{loaderData.previousPlan?.items.length ? `Copy ${loaderData.previousPlan.items.length} planned meal${loaderData.previousPlan.items.length === 1 ? "" : "s"}, then add or remove anything for this week.` : "The previous week has no planned meals to copy."}</p></div></div>
        <Form method="post"><input type="hidden" name="week" value={loaderData.start} /><Button name="intent" value="copy-previous" variant="secondary" disabled={!loaderData.previousPlan?.items.length}><Copy size={16} /> Copy previous week</Button></Form>
      </section> : null}
      {loaderData.clonedCount > 0 ? <div className="plan-copy-success" role="status"><Check size={16} /> Copied {loaderData.clonedCount} meal{loaderData.clonedCount === 1 ? "" : "s"} from the previous week.</div> : null}
      {loaderData.addRecipe ? <section className="plan-add"><div><p className="eyebrow">Add recipe</p><h2>{loaderData.addRecipe.name}</h2></div><Form method="post"><input type="hidden" name="week" value={loaderData.start} /><input type="hidden" name="recipeId" value={loaderData.addRecipe.id} /><label>Date<select name="date" defaultValue={loaderData.addDate}>{loaderData.dates.map((date) => <option key={date} value={date}>{dayLabel(date)}</option>)}</select></label><label>Section<select name="slot" defaultValue={loaderData.addSlot}>{loaderData.slots.filter((slot) => slot.active).map((slot) => <option key={slot.id} value={slot.id}>{slot.label}</option>)}</select></label><label>Servings<Input name="servings" type="number" min="0.25" max="100" step="0.25" defaultValue={loaderData.addServings ?? loaderData.addRecipe.servings ?? 4} /></label><Button type="submit"><Plus size={17} /> Add</Button></Form></section> : null}
      <div className="week-grid"><div className="week-corner"><CalendarDays size={18} /></div>{loaderData.dates.map((date) => <div className="day-heading" key={date}>{dayLabel(date)}</div>)}{loaderData.slots.map((slot) => <div className="week-row" key={slot.id}><div className="slot-heading">{slot.label}</div>{loaderData.dates.map((date) => { const dayItems = items.filter((item) => item.plannedDate === date && item.mealSlot === slot.id); return <div className="meal-slot-cell" key={`${date}-${slot.id}`}>{dayItems.map((item) => <article className="planned-meal" key={item.id}><Link to={`/recipes/${item.recipeId}?planItem=${encodeURIComponent(item.id)}`}>{item.recipeName}</Link><Form method="post" className="plan-servings-form"><input type="hidden" name="week" value={loaderData.start} /><input type="hidden" name="itemId" value={item.id} /><Input name="servings" type="number" min="0.25" max="100" step="0.25" defaultValue={item.servings} aria-label={`Servings for ${item.recipeName}`} /><Button name="intent" value="update-servings" variant="ghost" size="icon" aria-label={`Update servings for ${item.recipeName}`} title="Update servings"><Check size={13} /></Button></Form><Form method="post" className="plan-remove"><input type="hidden" name="week" value={loaderData.start} /><input type="hidden" name="itemId" value={item.id} /><button name="intent" value="remove" aria-label={`Remove ${item.recipeName}`}><Trash2 size={14} /></button></Form></article>)}{slot.active ? <Link className="meal-slot-add" to={withMealPlanSelection("/recipes", { week: loaderData.start, date, slot: slot.id })}><Plus size={15} /><span>Add</span></Link> : null}</div>; })}</div>)}</div>
      {loaderData.plan ? <div className="plan-footer"><Link className="button button-primary button-default" to={`/shopping?plan=${loaderData.plan.id}&week=${loaderData.start}`}>Build shopping list</Link></div> : null}
    </div>
  );
}

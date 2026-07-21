import { ArrowLeft, CalendarDays, CalendarPlus, Check, FileDown, Heart, LockKeyhole, Minus, Pencil, Plus, Scale, Users } from "lucide-react";
import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/recipe-detail";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cloudflareContext } from "../context";
import { createStorageClient } from "../../src/storage";
import { requireRequestSession } from "../../src/auth/server";
import { displayIngredientLine, resolveServingScale } from "../../src/domain/quantity/display";
import { readMealPlanSelection, withMealPlanSelection, type MealPlanSelection } from "../../src/domain/planning/selection";
import { resolvePlannedServingUpdate } from "../../src/domain/planning/meal-plans";

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const access = { userId: session.user.id, householdId: session.householdId };
  const storage = createStorageClient(env);
  const recipe = await storage.getRecipe(params.recipeId, access);
  if (!recipe) throw new Response("Recipe not found", { status: 404 });
  const url = new URL(request.url);
  const planSelection = readMealPlanSelection(url.searchParams);
  const requestedPlanItem = url.searchParams.get("planItem") ?? "";
  const [favorite, measurementSystem, mealSlots, planContext] = await Promise.all([
    storage.isFavorite(session.user.id, recipe.id),
    storage.getMeasurementSystem(session.user.id, session.householdId),
    storage.getMealPlanSlots(access),
    requestedPlanItem ? storage.getMealPlanItemContext(access, requestedPlanItem, recipe.id) : null,
  ]);
  const serving = resolveServingScale(recipe.servings, planContext?.servings ?? url.searchParams.get("servings"));
  const slotId = planContext?.mealSlot ?? planSelection?.slot;
  return {
    recipe,
    favorite,
    measurementSystem,
    selectedServings: planContext?.servings ?? serving.servings,
    servingScale: serving.scale,
    planSelection,
    planContext,
    planSlotLabel: mealSlots.find((slot) => slot.id === slotId)?.label ?? null,
    planServingsUpdated: url.searchParams.get("planServings") === "updated",
  };
}

export async function action({ params, context, request }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const data = await request.formData();
  const access = { userId: session.user.id, householdId: session.householdId };
  const storage = createStorageClient(env);
  if (data.get("intent") === "update-planned-servings") {
    const itemId = String(data.get("planItem") ?? "");
    const planContext = await storage.getMealPlanItemContext(access, itemId, params.recipeId);
    if (!planContext) throw new Response("Meal plan entry not found", { status: 404 });
    const servings = resolvePlannedServingUpdate(planContext.servings, data.get("servings"), data.get("adjustment"));
    const planId = await storage.updateMealPlanItemServings({ householdId: session.householdId, userId: session.user.id, itemId, servings });
    await storage.refreshShoppingListForPlan(access, planId);
    return redirect(`/recipes/${params.recipeId}?planItem=${encodeURIComponent(itemId)}&planServings=updated`);
  }
  if (data.get("intent") === "visibility") {
    await storage.setRecipeVisibility(params.recipeId, access, data.get("visibility") === "household" ? "household" : "user_private");
  } else await storage.setFavorite(access, params.recipeId, data.get("favorite") === "true");
  const planItem = String(data.get("planItem") ?? "");
  const servings = String(data.get("servings") ?? "");
  const detailPath = `/recipes/${params.recipeId}${planItem ? `?planItem=${encodeURIComponent(planItem)}` : servings ? `?servings=${encodeURIComponent(servings)}` : ""}`;
  return redirect(withMealPlanSelection(detailPath, readMealPlanSelection(data)));
}

function PlanSelectionFields({ selection }: { selection: MealPlanSelection | null }) {
  if (!selection) return null;
  return <><input type="hidden" name="planWeek" value={selection.week} /><input type="hidden" name="planDate" value={selection.date} /><input type="hidden" name="planSlot" value={selection.slot} /></>;
}

function PlanItemField({ itemId }: { itemId: string | null }) {
  return itemId ? <input type="hidden" name="planItem" value={itemId} /> : null;
}

const plannedDateLabel = (date: string) => new Intl.DateTimeFormat("en", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
}).format(new Date(`${date}T00:00:00Z`));

export default function RecipeDetail({ loaderData }: Route.ComponentProps) {
  const { recipe, favorite, measurementSystem, selectedServings, servingScale, planSelection, planContext, planSlotLabel } = loaderData;
  const servingStep = selectedServings !== null && selectedServings < 1 ? 0.25 : 1;
  const decreaseServings = selectedServings === null ? null : Math.max(0.25, selectedServings - servingStep);
  const increaseServings = selectedServings === null ? null : Math.min(1_000, selectedServings + servingStep);
  const detailUrl = (servings: number | null) => withMealPlanSelection(`/recipes/${recipe.id}${servings === null ? "" : `?servings=${servings}`}`, planSelection);
  const planUrl = planContext ? `/plan?week=${encodeURIComponent(planContext.startsOn)}` : null;
  return (
    <div className="page-shell detail-page">
      <Link to={planUrl ?? withMealPlanSelection("/recipes", planSelection)} className="back-link"><ArrowLeft size={17} /> {planContext ? "Back to meal plan" : "Back to recipes"}</Link>
      {planContext ? <section className="recipe-plan-context" aria-label="Meal plan context">
        <CalendarDays size={20} />
        <div><p className="eyebrow">Viewing from meal plan</p><strong>{planContext.planName}</strong><span>{plannedDateLabel(planContext.plannedDate)} · {planSlotLabel ?? planContext.mealSlot} · {planContext.servings} servings</span></div>
        {loaderData.planServingsUpdated ? <span className="settings-saved" role="status"><Check size={15} /> Plan updated</span> : <Link to={planUrl ?? "/plan"}>View week</Link>}
      </section> : null}
      <header className="detail-header">
        <div>
          <div className="tag-row">{recipe.visibility !== "catalog" ? <Badge>{recipe.visibility === "user_private" ? "Only me" : "Household"}</Badge> : null}{recipe.tags.slice(0, 5).map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>
          <h1>{recipe.name}</h1>
          <p>{recipe.description || "A recipe from the family catalog."}</p>
          <div className="detail-meta">
            <span><Users size={17} /> {selectedServings ?? "Unknown"} servings</span>
            <span><Scale size={17} /> {measurementSystem === "original" ? "Original units" : measurementSystem === "metric" ? "Metric units" : "US customary units"}</span>
          </div>
        </div>
        <div className="detail-actions">
          <a className="button button-secondary button-default" target="_blank" rel="noreferrer" href={`/api/v1/recipes/${recipe.id}/pdf?servings=${selectedServings ?? recipe.servings ?? 4}&measurementSystem=${measurementSystem}`}><FileDown size={17} /> PDF</a>
          <Form method="post"><input type="hidden" name="favorite" value={favorite ? "false" : "true"} /><PlanItemField itemId={planContext?.itemId ?? null} />{planContext || selectedServings === null ? null : <input type="hidden" name="servings" value={selectedServings} />}<PlanSelectionFields selection={planSelection} /><Button variant="secondary" size="icon" title={favorite ? "Remove favorite" : "Save favorite"} aria-label={favorite ? "Remove favorite" : "Save favorite"}><Heart size={18} fill={favorite ? "currentColor" : "none"} /></Button></Form>
          {recipe.isOwner ? <Link className="button button-secondary button-icon" title="Edit recipe" aria-label="Edit recipe" to={`/recipes/${recipe.id}/edit`}><Pencil size={17} /></Link> : null}
          {recipe.isOwner ? <Form method="post"><input type="hidden" name="visibility" value={recipe.visibility === "user_private" ? "household" : "user_private"} /><PlanItemField itemId={planContext?.itemId ?? null} />{planContext || selectedServings === null ? null : <input type="hidden" name="servings" value={selectedServings} />}<PlanSelectionFields selection={planSelection} /><Button name="intent" value="visibility" variant="secondary">{recipe.visibility === "user_private" ? <Users size={17} /> : <LockKeyhole size={17} />}{recipe.visibility === "user_private" ? "Share" : "Make private"}</Button></Form> : null}
          {planContext ? <Link className="button button-primary button-default" to={planUrl ?? "/plan"}><CalendarDays size={18} /> View meal plan</Link> : recipe.visibility !== "user_private" ? planSelection ? <Form method="post" action="/plan"><input type="hidden" name="week" value={planSelection.week} /><input type="hidden" name="date" value={planSelection.date} /><input type="hidden" name="slot" value={planSelection.slot} /><input type="hidden" name="recipeId" value={recipe.id} /><input type="hidden" name="servings" value={selectedServings ?? recipe.servings ?? 4} /><Button type="submit"><CalendarPlus size={18} /> Add to {planSlotLabel ?? planSelection.slot}</Button></Form> : <Link className="button button-primary button-default" to={`/plan?add=${recipe.id}${selectedServings === null ? "" : `&servings=${selectedServings}`}`}><CalendarPlus size={18} /> Add to plan</Link> : null}
        </div>
      </header>

      <div className="detail-columns">
        <section className="ingredients-panel">
          <div className="section-heading ingredient-heading"><div><p className="eyebrow">For the table</p><h2>Ingredients</h2></div>{selectedServings !== null ? planContext ? <Form key={`${planContext.itemId}-${selectedServings}`} method="post" className="serving-adjuster planned-serving-adjuster"><input type="hidden" name="intent" value="update-planned-servings" /><input type="hidden" name="planItem" value={planContext.itemId} /><button className="serving-step" name="adjustment" value="decrease" aria-label="Decrease planned servings" title="Decrease planned servings"><Minus size={15} /></button><div className="planned-serving-input"><label htmlFor="recipe-plan-servings">Servings</label><Input id="recipe-plan-servings" name="servings" type="number" min="0.25" max="100" step="0.25" defaultValue={selectedServings} /><Button name="adjustment" value="manual" type="submit" variant="ghost" size="icon" aria-label="Update planned servings" title="Update planned servings"><Check size={15} /></Button></div><button className="serving-step" name="adjustment" value="increase" aria-label="Increase planned servings" title="Increase planned servings"><Plus size={15} /></button></Form> : <div className="serving-adjuster"><Link className="serving-step" aria-label="Decrease servings" title="Decrease servings" to={detailUrl(decreaseServings)}><Minus size={15} /></Link><Form key={`${selectedServings}-${planSelection?.date ?? "library"}-${planSelection?.slot ?? ""}`} method="get"><label htmlFor="recipe-servings">Servings</label><Input id="recipe-servings" name="servings" type="number" min="0.25" max="1000" step="0.25" defaultValue={selectedServings} /><PlanSelectionFields selection={planSelection} /><Button type="submit" variant="ghost" size="icon" aria-label="Apply servings" title="Apply servings"><Check size={15} /></Button></Form><Link className="serving-step" aria-label="Increase servings" title="Increase servings" to={detailUrl(increaseServings)}><Plus size={15} /></Link></div> : <span>{recipe.recipeIngredients.length} items</span>}</div>
          <ul className="ingredient-list">
            {recipe.recipeIngredients.map((item) => (
              <li key={item.id}>
                <span className={`parse-dot ${item.parseStatus}`} title={`Parse status: ${item.parseStatus}`} />
                <span>{displayIngredientLine(item, measurementSystem, servingScale)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="steps-panel">
          <div className="section-heading"><div><p className="eyebrow">Method</p><h2>Steps</h2></div><span>{recipe.steps.length} steps</span></div>
          <ol className="step-list">
            {recipe.steps.map((step) => <li key={step.position}><span>{step.position + 1}</span><p>{step.instruction}</p></li>)}
          </ol>
        </section>
      </div>
    </div>
  );
}

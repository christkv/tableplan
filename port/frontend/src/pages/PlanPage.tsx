import { CalendarDays, Check, ChevronLeft, ChevronRight, Copy, FileDown, Files, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { cachedRequest, errorMessage, json, MealPlan, patch, Preferences, RecipeDetail, remove, request, ShoppingList } from "../api";
import { Button, Input, Select } from "../components/ui";
import { addDays, dayLabel, startOfIsoWeek, weekDates } from "../lib/domain";

export function PlanPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const start = startOfIsoWeek(params.get("week") ?? new Date());
  const dates = weekDates(start);
  const end = dates[6];
  const [plan, setPlan] = useState<MealPlan | null>();
  const [previous, setPrevious] = useState<MealPlan | null>();
  const [addRecipe, setAddRecipe] = useState<RecipeDetail | null>();
  const [preferences, setPreferences] = useState<Preferences>();
  const [shopping, setShopping] = useState<ShoppingList | null>();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const addId = params.get("add");
      const [current, prior, prefs, latest, recipeToAdd] = await Promise.all([
        request<MealPlan | null>(`/api/v1/meal-plans?week=${start}`),
        request<MealPlan | null>(`/api/v1/meal-plans?week=${addDays(start, -7)}`),
        cachedRequest<Preferences>("/api/v1/preferences"),
        cachedRequest<ShoppingList | null>("/api/v1/shopping-lists/latest", 5_000),
        addId ? request<RecipeDetail>(`/api/v1/recipes/${encodeURIComponent(addId)}`) : Promise.resolve(null),
      ]);
      setPlan(current);
      setPrevious(prior);
      setPreferences(prefs);
      setShopping(latest);
      setAddRecipe(recipeToAdd);
    } catch (cause) { setError(errorMessage(cause, "Meal plan could not be loaded.")); }
  }, [start, params.get("add")]);
  useEffect(() => { void load(); }, [load]);
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const updated = await request<MealPlan>("/api/v1/meal-plans", json({
        week: start,
        recipeId: data.get("recipeId"),
        date: data.get("date"),
        slot: data.get("slot"),
        servings: Number(data.get("servings")),
        notes: data.get("notes") || null,
      }));
      const next = new URLSearchParams({ week: start });
      setParams(next);
      setPlan(updated);
      setAddRecipe(null);
    } catch (cause) { setError(errorMessage(cause, "Meal could not be added.")); }
  }
  async function clone() {
    try {
      setPlan(await request<MealPlan>("/api/v1/meal-plans/clone-previous", json({ targetWeek: start })));
    } catch (cause) { setError(errorMessage(cause, "The previous week could not be copied.")); }
  }
  async function removeItem(id: string) {
    setPlan(await request<MealPlan>(`/api/v1/meal-plan-items/${id}`, remove()));
  }
  async function updateServings(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const servings = Number(new FormData(event.currentTarget).get("servings"));
    setPlan(await request<MealPlan>(`/api/v1/meal-plan-items/${id}`, patch({ servings })));
  }
  async function buildShopping() {
    if (!plan || !preferences) return;
    await request("/api/v1/shopping-lists/generate", json({ planId: plan.id, measurementSystem: preferences.measurementSystem }));
    navigate("/shopping");
  }
  const configured = preferences?.mealSlots ?? [];
  const configuredIds = new Set(configured.map((slot) => slot.id));
  const legacy = [...new Set((plan?.items ?? []).map((item) => item.mealSlot))].filter((id) => !configuredIds.has(id)).map((id) => ({ id, label: id.replace(/[-_]/g, " "), active: false }));
  const slots = [...configured.map((slot) => ({ ...slot, active: true })), ...legacy];
  const items = plan?.items ?? [];
  const itemsByCell = useMemo(() => {
    const grouped = new Map<string, typeof items>();
    items.forEach((item) => {
      const key = `${item.plannedDate}|${item.mealSlot}`;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });
    return grouped;
  }, [items]);
  const selectedDate = dates.includes(params.get("date") ?? "") ? params.get("date")! : dates[0];
  const selectedSlot = configured.some((slot) => slot.id === params.get("slot")) ? params.get("slot")! : configured[0]?.id ?? "dinner";
  return <div className="page-shell plan-page">
    <header className="page-header"><div><p className="eyebrow">Weekly rhythm</p><h1>Meal plan</h1><p className="page-subtitle">{start} to {end}</p></div><div className="header-actions">{plan && <a className="button button-secondary button-icon" title="Download meal plan PDF" href={`/api/v1/meal-plans/${plan.id}/pdf`} target="_blank"><FileDown size={18} /></a>}{plan && shopping?.plan?.id === plan.id && <a className="button button-secondary button-icon" title="Download combined PDF" href={`/api/v1/meal-plans/${plan.id}/combined.pdf?shoppingListId=${shopping.id}`} target="_blank"><Files size={18} /></a>}<Link className="button button-secondary button-icon" aria-label="Previous week" to={`/plan?week=${addDays(start, -7)}`}><ChevronLeft size={18} /></Link><Link className="button button-secondary button-default" to="/plan">This week</Link><Link className="button button-secondary button-icon" aria-label="Next week" to={`/plan?week=${addDays(start, 7)}`}><ChevronRight size={18} /></Link></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {plan === undefined && <p className="recipe-load-sentinel"><LoaderCircle className="spin" /> Loading plan</p>}
    {!items.length && plan !== undefined && <section className="plan-copy"><div><Copy size={19} /><div><h2>Start from last week</h2><p>{previous?.items.length ? `Copy ${previous.items.length} planned meals, then adjust this week.` : "The previous week has no meals to copy."}</p></div></div><Button variant="secondary" disabled={!previous?.items.length} onClick={clone}><Copy size={16} /> Copy previous week</Button></section>}
    {addRecipe && <section className="plan-add"><div><p className="eyebrow">Add recipe</p><h2>{addRecipe.name}</h2></div><form onSubmit={add}><input type="hidden" name="recipeId" value={addRecipe.id} /><label>Date<Select name="date" defaultValue={selectedDate}>{dates.map((date) => <option value={date} key={date}>{dayLabel(date)}</option>)}</Select></label><label>Section<Select name="slot" defaultValue={selectedSlot}>{configured.map((slot) => <option value={slot.id} key={slot.id}>{slot.label}</option>)}</Select></label><label>Servings<Input name="servings" type="number" min=".25" max="100" step=".25" defaultValue={Number(params.get("servings")) || addRecipe.servings || 4} /></label><Button><Plus size={17} /> Add</Button></form></section>}
    {preferences && <div className="week-grid"><div className="week-corner"><CalendarDays size={18} /></div>{dates.map((date) => <div className="day-heading" key={date}>{dayLabel(date)}</div>)}{slots.map((slot) => <div className="week-row" key={slot.id}><div className="slot-heading">{slot.label}</div>{dates.map((date) => {
      const dayItems = itemsByCell.get(`${date}|${slot.id}`) ?? [];
      return <div className="meal-slot-cell" key={`${date}-${slot.id}`}>{dayItems.map((item) => <article className="planned-meal" key={item.id}><Link to={`/recipes/${item.recipeId}?planItem=${item.id}`}>{item.recipeName}</Link><form className="plan-servings-form" onSubmit={(event) => updateServings(event, item.id)}><Input name="servings" type="number" min=".25" max="100" step=".25" defaultValue={item.servings} aria-label={`Servings for ${item.recipeName}`} /><Button variant="ghost" size="icon"><Check size={13} /></Button></form><Button className="plan-remove" variant="ghost" size="icon" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.recipeName}`}><Trash2 size={14} /></Button></article>)}{slot.active && <Link className="meal-slot-add" to={`/recipes?planWeek=${start}&planDate=${date}&planSlot=${slot.id}`}><Plus size={15} /><span>Add</span></Link>}</div>;
    })}</div>)}</div>}
    {plan && <div className="plan-footer"><Button onClick={buildShopping}>Build shopping list</Button></div>}
  </div>;
}

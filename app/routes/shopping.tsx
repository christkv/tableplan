import { CalendarDays, ChevronRight, CircleAlert, ListChecks, Sparkles } from "lucide-react";
import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/shopping";
import { Button } from "~/components/ui/button";
import { cloudflareContext } from "../context";
import { requireRequestSession } from "../../src/auth/server";
import { addDays, startOfIsoWeek } from "../../src/domain/planning/dates";
import { formatNumber } from "../../src/domain/quantity/format";
import { generateShoppingList, getLatestShoppingList, toggleShoppingItem } from "../../src/db/shopping";
import { getMeasurementSystem } from "../../src/db/preferences";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const url = new URL(request.url);
  const measurementSystem = await getMeasurementSystem(env.DB, session.user.id, session.householdId);
  return { list: await getLatestShoppingList(env.DB, session.householdId, measurementSystem), measurementSystem, planId: url.searchParams.get("plan"), week: url.searchParams.get("week") };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const data = await request.formData();
  if (data.get("intent") === "toggle") {
    await toggleShoppingItem(env.DB, session.householdId, String(data.get("itemId")), data.get("checked") !== "true");
  } else {
    const start = startOfIsoWeek(String(data.get("week")));
    const measurementSystem = await getMeasurementSystem(env.DB, session.user.id, session.householdId);
    await generateShoppingList(env.DB, { householdId: session.householdId, planId: String(data.get("planId")), startsOn: start, endsOn: addDays(start, 6), userId: session.user.id, measurementSystem });
  }
  return redirect("/shopping");
}

const quantityText = (min: string | null, max: string | null, unit: string | null) => min === null ? "" : `${formatNumber(Number(min))}${max === null ? "" : `-${formatNumber(Number(max))}`} ${unit ?? ""}`.trim();

export default function Shopping({ loaderData }: Route.ComponentProps) {
  return (
    <div className="page-shell"><header className="page-header"><div><p className="eyebrow">One trip, one list</p><h1>Shopping list</h1><p className="page-subtitle">Combined quantities from the meals you plan.</p></div>{loaderData.planId && loaderData.week ? <Form method="post"><input type="hidden" name="planId" value={loaderData.planId} /><input type="hidden" name="week" value={loaderData.week} /><Button><Sparkles size={17} /> Generate from plan</Button></Form> : <Link className="button button-secondary button-default" to="/plan">Open meal plan</Link>}</header>
      {loaderData.list?.items.length ? <section className="shopping-list"><div className="shopping-title"><ListChecks size={20} /><h2>{loaderData.list.name}</h2><span>{loaderData.measurementSystem === "metric" ? "Metric (EU)" : loaderData.measurementSystem === "us" ? "US customary" : "Original"} · {loaderData.list.items.filter((item) => !item.checked).length} left</span></div>{loaderData.list.plan ? <Link className="shopping-source" to={`/plan?week=${loaderData.list.plan.startsOn}`}><CalendarDays size={19} /><div><strong>{loaderData.list.plan.name}</strong><small>{loaderData.list.plan.startsOn} to {loaderData.list.plan.endsOn} · {loaderData.list.plan.mealCount} planned meal{loaderData.list.plan.mealCount === 1 ? "" : "s"}</small></div><ChevronRight size={17} /></Link> : null}{loaderData.list.items.map((item) => <Form method="post" className={`shopping-row${item.checked ? " checked" : ""}`} key={item.id}><input type="hidden" name="intent" value="toggle" /><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="checked" value={String(item.checked)} /><button type="submit" className="check-control" aria-label={`${item.checked ? "Uncheck" : "Check"} ${item.name}`}><span /></button><div><strong>{item.name}</strong><small>{item.sources.map((source) => source.recipeName).join(", ")}</small></div><span className="shopping-quantity">{quantityText(item.quantityMin, item.quantityMax, item.unitId)}</span>{item.unresolved ? <CircleAlert size={16} className="unresolved-icon" aria-label="Original quantity preserved" /> : null}</Form>)}</section>
      : <section className="empty-state"><ListChecks size={26} /><h2>Your list is clear</h2><p>{loaderData.planId ? "Generate the combined ingredients from this plan." : "Plan a few meals, then build the combined ingredient list."}</p></section>}
    </div>
  );
}

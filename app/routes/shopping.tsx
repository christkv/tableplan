import { CalendarDays, ChevronRight, CircleAlert, ExternalLink, FileDown, Files, Link2, ListChecks, Mail, Sparkles, Trash2 } from "lucide-react";
import { data, Form, Link, redirect } from "react-router";

import type { Route } from "./+types/shopping";
import { Button } from "~/components/ui/button";
import { cloudflareContext } from "../context";
import { requireRequestSession } from "../../src/auth/server";
import { addDays, startOfIsoWeek } from "../../src/domain/planning/dates";
import { formatNumber } from "../../src/domain/quantity/format";
import { generateShoppingList, getLatestShoppingList, toggleShoppingItem } from "../../src/db/shopping";
import { getMeasurementSystem } from "../../src/db/preferences";
import { queueShoppingListEmail } from "../../src/email/shopping-email";
import { createShoppingShare, listShoppingShares, parseShareExpiryDays, revokeShoppingShare } from "../../src/sharing/shopping-share";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const url = new URL(request.url);
  const measurementSystem = await getMeasurementSystem(env.DB, session.user.id, session.householdId);
  const list = await getLatestShoppingList(env.DB, session.householdId, measurementSystem);
  return { list, shares: list ? await listShoppingShares(env.DB, session.householdId, list.id) : [], measurementSystem, userEmail: session.user.email, planId: url.searchParams.get("plan"), week: url.searchParams.get("week") };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "generate");
  if (intent === "toggle") {
    await toggleShoppingItem(env.DB, session.householdId, String(formData.get("itemId")), formData.get("checked") !== "true");
  } else if (intent === "email" || intent === "share") {
    const listId = String(formData.get("listId"));
    const expiresInDays = parseShareExpiryDays(formData.get("expiresInDays"));
    if (intent === "email") {
      const result = await queueShoppingListEmail(env, { householdId: session.householdId, userId: session.user.id, listId, recipientEmail: session.user.email, expiresInDays });
      return data({ intent, ...result, message: env.EMAIL_MODE === "cloud" ? `Shopping list queued for ${session.user.email}.` : `Email captured locally for ${session.user.email}.` });
    }
    const share = await createShoppingShare(env.DB, { householdId: session.householdId, userId: session.user.id, listId, expiresInDays });
    const baseUrl = (env.PUBLIC_APP_URL ?? env.BETTER_AUTH_URL).replace(/\/$/, "");
    return data({ intent, shareId: share.id, shareUrl: `${baseUrl}/shared/shopping#access=${encodeURIComponent(share.token)}`, expiresAt: share.expiresAt, message: "Store checklist link created." });
  } else if (intent === "revoke") {
    await revokeShoppingShare(env.DB, session.householdId, String(formData.get("listId")), String(formData.get("shareId")));
  } else {
    const start = startOfIsoWeek(String(formData.get("week")));
    const measurementSystem = await getMeasurementSystem(env.DB, session.user.id, session.householdId);
    await generateShoppingList(env.DB, { householdId: session.householdId, planId: String(formData.get("planId")), startsOn: start, endsOn: addDays(start, 6), userId: session.user.id, measurementSystem });
  }
  return redirect("/shopping");
}

const quantityText = (min: string | null, max: string | null, unit: string | null) => min === null ? "" : `${formatNumber(Number(min))}${max === null ? "" : `-${formatNumber(Number(max))}`} ${unit ?? ""}`.trim();

export default function Shopping({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div className="page-shell"><header className="page-header"><div><p className="eyebrow">One trip, one list</p><h1>Shopping list</h1><p className="page-subtitle">Combined quantities from the meals you plan.</p></div>{loaderData.planId && loaderData.week ? <Form method="post"><input type="hidden" name="planId" value={loaderData.planId} /><input type="hidden" name="week" value={loaderData.week} /><Button><Sparkles size={17} /> Generate from plan</Button></Form> : <Link className="button button-secondary button-default" to="/plan">Open meal plan</Link>}</header>
      {loaderData.list?.items.length ? <><section className="shopping-tools" aria-label="Shopping list actions"><div className="shopping-export-actions"><a className="button button-secondary button-default" target="_blank" rel="noreferrer" href={`/api/v1/shopping-lists/${loaderData.list.id}/pdf`}><FileDown size={17} /> List PDF</a>{loaderData.list.plan ? <a className="button button-secondary button-default" target="_blank" rel="noreferrer" href={`/api/v1/meal-plans/${loaderData.list.plan.id}/combined.pdf?shoppingListId=${loaderData.list.id}`}><Files size={17} /> Combined PDF</a> : null}</div><Form method="post" className="shopping-share-form"><input type="hidden" name="listId" value={loaderData.list.id} /><label>Link expires<select name="expiresInDays" defaultValue="14"><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label><Button name="intent" value="share" variant="secondary"><Link2 size={16} /> Create link</Button><Button name="intent" value="email"><Mail size={16} /> Email to me</Button></Form></section>{actionData?.message ? <section className="share-result" role="status"><div><strong>{actionData.message}</strong><small>The link expires {new Date(actionData.expiresAt).toLocaleString()}.</small></div><a className="button button-secondary button-default" href={actionData.shareUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open checklist</a></section> : null}<section className="shopping-list"><div className="shopping-title"><ListChecks size={20} /><h2>{loaderData.list.name}</h2><span>{loaderData.measurementSystem === "metric" ? "Metric (EU)" : loaderData.measurementSystem === "us" ? "US customary" : "Original"} · {loaderData.list.items.filter((item) => !item.checked).length} left</span></div>{loaderData.list.plan ? <Link className="shopping-source" to={`/plan?week=${loaderData.list.plan.startsOn}`}><CalendarDays size={19} /><div><strong>{loaderData.list.plan.name}</strong><small>{loaderData.list.plan.startsOn} to {loaderData.list.plan.endsOn} · {loaderData.list.plan.mealCount} planned meal{loaderData.list.plan.mealCount === 1 ? "" : "s"}</small></div><ChevronRight size={17} /></Link> : null}{loaderData.list.items.map((item) => <Form method="post" className={`shopping-row${item.checked ? " checked" : ""}`} key={item.id}><input type="hidden" name="intent" value="toggle" /><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="checked" value={String(item.checked)} /><button type="submit" className="check-control" aria-label={`${item.checked ? "Uncheck" : "Check"} ${item.name}`}><span /></button><div><strong>{item.name}</strong><small>{item.sources.map((source) => source.recipeName).join(", ")}</small></div><span className="shopping-quantity">{quantityText(item.quantityMin, item.quantityMax, item.unitId)}</span>{item.unresolved ? <CircleAlert size={16} className="unresolved-icon" aria-label="Original quantity preserved" /> : null}</Form>)}</section>{loaderData.shares.some((share) => !share.revokedAt && new Date(share.expiresAt) > new Date()) ? <section className="active-share-list"><h2>Active store links</h2>{loaderData.shares.filter((share) => !share.revokedAt && new Date(share.expiresAt) > new Date()).map((share) => <div key={share.id}><span><strong>Link {share.tokenPrefix}...</strong><small>Expires {new Date(share.expiresAt).toLocaleString()}</small></span><Form method="post"><input type="hidden" name="listId" value={loaderData.list!.id} /><input type="hidden" name="shareId" value={share.id} /><Button name="intent" value="revoke" variant="ghost" size="icon" title="Revoke link" aria-label={`Revoke link ${share.tokenPrefix}`}><Trash2 size={16} /></Button></Form></div>)}</section> : null}</>
      : <section className="empty-state"><ListChecks size={26} /><h2>Your list is clear</h2><p>{loaderData.planId ? "Generate the combined ingredients from this plan." : "Plan a few meals, then build the combined ingredient list."}</p></section>}
    </div>
  );
}

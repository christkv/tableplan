import { Check, ListChecks, LogOut, RefreshCw } from "lucide-react";
import { data, useFetcher } from "react-router";

import type { Route } from "./+types/shared-shopping";
import { cloudflareContext } from "../context";
import { formatNumber } from "../../src/domain/quantity/format";
import { getPublicShoppingList, publicSecurityHeaders, readShareCookie, resolveShoppingShare, togglePublicShoppingItem } from "../../src/sharing/shopping-share";

export function headers() { return publicSecurityHeaders(); }

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const share = await resolveShoppingShare(env.DB, readShareCookie(request) ?? "", params.shareId);
  if (!share) throw new Response("This checklist link has expired or was revoked.", { status: 410, headers: publicSecurityHeaders() });
  const list = await getPublicShoppingList(env.DB, share);
  if (!list) throw new Response("This checklist is no longer available.", { status: 410, headers: publicSecurityHeaders() });
  ctx.waitUntil(env.DB.prepare("UPDATE shopping_list_shares SET last_accessed_at=CURRENT_TIMESTAMP WHERE id=?").bind(share.id).run().then(() => undefined));
  return data({ list, shareId: share.id }, { headers: publicSecurityHeaders() });
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new Response("Invalid request origin", { status: 403 });
  const share = await resolveShoppingShare(env.DB, readShareCookie(request) ?? "", params.shareId);
  if (!share) throw new Response("This checklist link has expired or was revoked.", { status: 410 });
  const form = await request.formData();
  const itemId = String(form.get("itemId") ?? "");
  const checked = form.get("checked") === "true";
  if (!await togglePublicShoppingItem(env.DB, share, itemId, checked)) throw new Response("Shopping item not found", { status: 404 });
  return { itemId, checked };
}

const quantityText = (min: string | null, max: string | null, unit: string | null) => min === null ? "" : `${formatNumber(Number(min))}${max === null ? "" : `-${formatNumber(Number(max))}`} ${unit ?? ""}`.trim();

function SharedItem({ item }: { item: Route.ComponentProps["loaderData"]["list"]["items"][number] }) {
  const fetcher = useFetcher();
  const pendingValue = fetcher.formData?.get("checked");
  const checked = pendingValue === null || pendingValue === undefined ? item.checked : pendingValue === "true";
  return <fetcher.Form method="post" className={`shared-item${checked ? " checked" : ""}`}>
    <input type="hidden" name="itemId" value={item.id} />
    <input type="hidden" name="checked" value={String(!checked)} />
    <button type="submit" className="shared-check" aria-label={`${checked ? "Uncheck" : "Check"} ${item.name}`} disabled={fetcher.state !== "idle"}>{checked ? <Check size={18} /> : null}</button>
    <div><strong>{item.name}</strong>{item.unresolved ? <small>Original quantity</small> : null}</div>
    <span>{quantityText(item.quantityMin, item.quantityMax, item.unitId)}</span>
  </fetcher.Form>;
}

export default function SharedShopping({ loaderData }: Route.ComponentProps) {
  const remaining = loaderData.list.items.filter((item) => !item.checked).length;
  return <main className="shared-page">
    <header className="shared-header"><div className="shared-brand"><span className="brand-mark"><ListChecks size={19} /></span><strong>Tableplan</strong></div><form method="post" action="/api/public/shopping/logout"><button className="shared-exit" title="Clear checklist access" aria-label="Clear checklist access"><LogOut size={18} /></button></form></header>
    <section className="shared-summary"><p className="eyebrow">Store checklist</p><h1>{loaderData.list.name}</h1>{loaderData.list.plan ? <p>{loaderData.list.plan.startsOn} to {loaderData.list.plan.endsOn}</p> : null}<div><strong>{remaining}</strong> left <span>of {loaderData.list.items.length}</span></div></section>
    <section className="shared-list" aria-label="Shopping items">{loaderData.list.items.map((item) => <SharedItem key={item.id} item={item} />)}</section>
    <footer className="shared-footer"><RefreshCw size={14} /><span>Updated {new Date(loaderData.list.updatedAt).toLocaleString()}</span></footer>
  </main>;
}

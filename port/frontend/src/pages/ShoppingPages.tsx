import { CalendarDays, Check, ChevronRight, CircleAlert, ExternalLink, FileDown, Files, Link2, ListChecks, LoaderCircle, LogOut, Mail, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  errorMessage,
  json,
  patch,
  Preferences,
  remove,
  request,
  ShareView,
  ShoppingItemUpdate,
  ShoppingList,
  ShoppingOverview,
  PublicShoppingItemUpdate,
} from "../api";
import { Button, Select } from "../components/ui";
import { BrandMark, BrandName } from "../components/Brand";
import { quantityText } from "../lib/domain";

interface EmailDelivery {
  id: string;
  recipientEmail: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  sentAt: string | null;
}

export function ShoppingPage() {
  const [params] = useSearchParams();
  const [list, setList] = useState<ShoppingList | null>();
  const [shares, setShares] = useState<ShareView[]>([]);
  const [preferences, setPreferences] = useState<Preferences>();
  const [shareLink, setShareLink] = useState("");
  const [delivery, setDelivery] = useState<EmailDelivery>();
  const [deliveryPollAttempt, setDeliveryPollAttempt] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const overview = await request<ShoppingOverview>("/api/v1/shopping-overview");
      setList(overview.list);
      setPreferences(overview.preferences);
      setShares(overview.shares);
    } catch (cause) { setError(errorMessage(cause, "Shopping list could not be loaded.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!delivery || ["sent", "failed"].includes(delivery.status)) return;
    const delay = document.hidden ? 10_000 : Math.min(1_500 * 2 ** deliveryPollAttempt, 10_000);
    const timer = window.setTimeout(async () => {
      try {
        setDelivery(await request(`/api/v1/email-deliveries/${delivery.id}`));
        setDeliveryPollAttempt((attempt) => attempt + 1);
      } catch (cause) {
        setError(errorMessage(cause, "Email status could not be refreshed."));
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [delivery, deliveryPollAttempt]);
  async function generate() {
    const planId = params.get("plan");
    if (!planId || !preferences) return;
    setList(await request("/api/v1/shopping-lists/generate", json({ planId, measurementSystem: preferences.measurementSystem })));
    setMessage("Shopping list generated.");
    await load();
  }
  async function refresh() {
    if (!list) return;
    setList(await request(`/api/v1/shopping-lists/${list.id}/refresh`, json({})));
    setMessage("Shopping list refreshed from the plan.");
  }
  async function toggle(itemId: string, checked: boolean) {
    const previous = list;
    if (!previous) return;
    setList({ ...previous, items: previous.items.map((item) => item.id === itemId ? { ...item, checked } : item) });
    try {
      const update = await request<ShoppingItemUpdate>(`/api/v1/shopping-items/${itemId}`, patch({ checked }));
      setList((current) => current ? {
        ...current,
        version: update.version,
        updatedAt: update.updatedAt,
        items: current.items.map((item) => item.id === itemId ? update.item : item),
      } : current);
    } catch (cause) {
      setList(previous);
      setError(errorMessage(cause, "Shopping item could not be updated."));
    }
  }
  async function createShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!list) return;
    const expiresInDays = Number(new FormData(event.currentTarget).get("expiresInDays"));
    const intent = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    if (intent === "email") {
      const next = await request<EmailDelivery>(`/api/v1/shopping-lists/${list.id}/email`, json({ expiresInDays }));
      setDelivery(next);
      setDeliveryPollAttempt(0);
      setMessage(`Shopping list queued for ${next.recipientEmail}.`);
      return;
    }
    const share = await request<ShareView>(`/api/v1/shopping-lists/${list.id}/shares`, json({ expiresInDays }));
    const link = `${location.origin}/shared/shopping?shareId=${encodeURIComponent(share.id)}&token=${encodeURIComponent(share.token ?? "")}`;
    setShareLink(link);
    setMessage("Store checklist link created.");
    setShares(await request(`/api/v1/shopping-lists/${list.id}/shares`));
  }
  async function revoke(id: string) {
    if (!list) return;
    await request(`/api/v1/shopping-lists/${list.id}/shares/${id}`, remove());
    setShares((current) => current.map((share) => share.id === id ? { ...share, revokedAt: new Date().toISOString() } : share));
  }
  const activeShares = shares.filter((share) => !share.revokedAt && new Date(share.expiresAt) > new Date());
  return <div className="page-shell">
    <header className="page-header"><div><p className="eyebrow">One trip, one list</p><h1>Shopping list</h1><p className="page-subtitle">Combined quantities from the meals you plan.</p></div><div className="header-actions">{params.get("plan") ? <Button onClick={generate}><Sparkles size={17} /> Generate from plan</Button> : <Link className="button button-secondary button-default" to="/plan">Open meal plan</Link>}{list && <Button variant="secondary" onClick={refresh}><RefreshCw size={16} /> Refresh</Button>}</div></header>
    {message && <p className="settings-saved" role="status"><Check size={15} /> {message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {list === undefined && <p className="recipe-load-sentinel"><LoaderCircle className="spin" /> Loading shopping list</p>}
    {list?.items.length ? <><section className="shopping-tools"><div className="shopping-export-actions"><a className="button button-secondary button-default" target="_blank" href={`/api/v1/shopping-lists/${list.id}/pdf`}><FileDown size={17} /> List PDF</a>{list.plan && <a className="button button-secondary button-default" target="_blank" href={`/api/v1/meal-plans/${list.plan.id}/combined.pdf?shoppingListId=${list.id}`}><Files size={17} /> Combined PDF</a>}</div><form className="shopping-share-form" onSubmit={createShare}><label>Link expires<Select name="expiresInDays" defaultValue="14"><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></Select></label><Button name="intent" value="share" variant="secondary"><Link2 size={16} /> Create link</Button><Button name="intent" value="email"><Mail size={16} /> Email to me</Button></form></section>
      {shareLink && <section className="share-result"><div><strong>Private store checklist link</strong><a href={shareLink}>{shareLink}</a></div><a className="button button-secondary button-default" href={shareLink} target="_blank"><ExternalLink size={16} /> Open checklist</a></section>}
      {delivery && <section className="share-result"><div><strong>Email: {delivery.status}</strong><small>{delivery.status === "sent" ? `Sent ${new Date(delivery.sentAt!).toLocaleString()}` : delivery.lastError ?? `Attempt ${delivery.attemptCount}`}</small></div></section>}
      <section className="shopping-list"><div className="shopping-title"><ListChecks size={20} /><h2>{list.name}</h2><span>{list.measurementSystem === "metric" ? "Metric (EU)" : list.measurementSystem === "us" ? "US customary" : "Original"} · {list.items.filter((item) => !item.checked).length} left</span></div>{list.plan && <Link className="shopping-source" to={`/plan?week=${list.plan.startsOn}`}><CalendarDays size={19} /><div><strong>{list.plan.name}</strong><small>{list.plan.startsOn} to {list.plan.endsOn} · {list.plan.mealCount} planned meals</small></div><ChevronRight size={17} /></Link>}{list.items.map((item) => <div className={`shopping-row${item.checked ? " checked" : ""}`} key={item.id}><button className="check-control" onClick={() => toggle(item.id, !item.checked)} aria-label={`${item.checked ? "Uncheck" : "Check"} ${item.name}`}><span /></button><div><strong>{item.name}</strong><small>{item.sources?.map((source) => source.recipeName).join(", ")}</small></div><span className="shopping-quantity">{quantityText(item.quantityMin, item.quantityMax, item.unitId)}</span>{item.unresolved && <CircleAlert size={16} className="unresolved-icon" />}</div>)}</section>
      {!!activeShares.length && <section className="active-share-list"><h2>Active store links</h2>{activeShares.map((share) => <div key={share.id}><span><strong>Link {share.id.slice(0, 8)}…</strong><small>Expires {new Date(share.expiresAt).toLocaleString()}</small></span><Button variant="ghost" size="icon" onClick={() => revoke(share.id)}><Trash2 size={16} /></Button></div>)}</section>}
    </> : list !== undefined && <section className="empty-state"><ListChecks size={26} /><h2>Your list is clear</h2><p>{params.get("plan") ? "Generate the combined ingredients from this plan." : "Plan a few meals, then build the combined ingredient list."}</p></section>}
  </div>;
}

export function SharedExchangePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  useEffect(() => {
    const hash = new URLSearchParams(location.hash.slice(1));
    const token = params.get("token") ?? hash.get("access") ?? "";
    const shareId = params.get("shareId") ?? hash.get("shareId") ?? "";
    history.replaceState(null, "", location.pathname);
    if (!token || !shareId) { setError("This checklist link is incomplete or no longer available."); return; }
    request("/api/public/shopping/exchange", json({ shareId, token }))
      .then(() => navigate(`/shared/shopping/${encodeURIComponent(shareId)}`, { replace: true }))
      .catch((cause) => setError(errorMessage(cause, "This checklist link has expired or was revoked.")));
  }, []);
  return <main className="shared-loading"><div><span className="brand-mark"><ListChecks size={20} /></span>{error ? <><h1>Checklist unavailable</h1><p>{error}</p></> : <><LoaderCircle className="spin" size={24} /><h1>Opening your checklist</h1><p>Loading the latest shopping-list state.</p></>}</div></main>;
}

export function SharedShoppingPage() {
  const { shareId = "" } = useParams();
  const navigate = useNavigate();
  const [list, setList] = useState<ShoppingList>();
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => request<ShoppingList>(`/api/public/shopping/${encodeURIComponent(shareId)}`).then(setList).catch((cause) => setError(errorMessage(cause, "This checklist is unavailable."))), [shareId]);
  useEffect(() => { void load(); }, [load]);
  async function toggle(itemId: string, checked: boolean) {
    setPending(itemId);
    const previous = list;
    if (previous) setList({ ...previous, items: previous.items.map((item) => item.id === itemId ? { ...item, checked } : item) });
    try {
      const update = await request<PublicShoppingItemUpdate>(`/api/public/shopping/${encodeURIComponent(shareId)}/items/${itemId}`, patch({ checked }));
      setList((current) => current ? {
        ...current,
        updatedAt: update.updatedAt,
        items: current.items.map((item) => item.id === itemId ? update.item : item),
      } : current);
    } catch (cause) {
      setList(previous);
      setError(errorMessage(cause, "Checklist item could not be updated."));
    }
    finally { setPending(""); }
  }
  async function logout() {
    await request("/api/public/shopping/logout", json({}));
    navigate("/shared/shopping", { replace: true });
  }
  if (error) return <main className="shared-loading"><div><span className="brand-mark"><ListChecks size={20} /></span><h1>Checklist unavailable</h1><p>{error}</p></div></main>;
  if (!list) return <main className="shared-loading"><div><LoaderCircle className="spin" /><h1>Loading checklist</h1></div></main>;
  const remaining = list.items.filter((item) => !item.checked).length;
  return <main className="shared-page"><header className="shared-header"><div className="shared-brand"><BrandMark /><BrandName /></div><button className="shared-exit" onClick={logout}><LogOut size={18} /></button></header><section className="shared-summary"><p className="eyebrow">Store checklist</p><h1>{list.name}</h1><div><strong>{remaining}</strong> left <span>of {list.items.length}</span></div></section><section className="shared-list">{list.items.map((item) => <div className={`shared-item${item.checked ? " checked" : ""}`} key={item.id}><button className="shared-check" onClick={() => toggle(item.id, !item.checked)} disabled={pending === item.id}>{item.checked && <Check size={18} />}</button><div><strong>{item.name}</strong>{item.unresolved && <small>Original quantity</small>}</div><span>{quantityText(item.quantityMin, item.quantityMax, item.unitId)}</span></div>)}</section><footer className="shared-footer"><RefreshCw size={14} /><span>Updated {new Date(list.updatedAt).toLocaleString()}</span></footer></main>;
}

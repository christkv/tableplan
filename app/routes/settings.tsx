import { ArrowDown, ArrowUp, Check, KeyRound, Plus, Ruler, Trash2, UtensilsCrossed, Users } from "lucide-react";
import { useState } from "react";
import { Form, redirect } from "react-router";

import type { Route } from "./+types/settings";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cloudflareContext } from "../context";
import { createApiKey, listApiKeys, revokeApiKey, type ApiScope } from "../../src/auth/api-keys";
import { requireRequestSession } from "../../src/auth/server";
import { getMealPlanSlots, getMeasurementSystem, updateMealPlanSlots, updateMeasurementSystem } from "../../src/db/preferences";
import { maximumMealSlots, type MealSlotDefinition } from "../../src/domain/planning/slots";

const defaultScopes: ApiScope[] = ["recipes:read", "recipes:write", "plans:read", "plans:write", "shopping:read", "shopping:write"];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const url = new URL(request.url);
  const [keys, measurementSystem, mealSlots] = await Promise.all([
    listApiKeys(env.DB, session.user.id),
    getMeasurementSystem(env.DB, session.user.id, session.householdId),
    getMealPlanSlots(env.DB, session.householdId),
  ]);
  return { keys, measurementSystem, mealSlots, settingsSaved: url.searchParams.get("saved") };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const session = await requireRequestSession(request, env, ctx);
  const data = await request.formData();
  if (data.get("intent") === "measurement") {
    await updateMeasurementSystem(env.DB, session.user.id, session.householdId, data.get("measurementSystem"));
    return redirect("/settings?saved=measurements");
  }
  if (data.get("intent") === "meal-slots") {
    try {
      await updateMealPlanSlots(env.DB, session.householdId, data.getAll("mealSlotId"), data.getAll("mealSlotLabel"));
      return redirect("/settings?saved=meal-slots");
    } catch (error) {
      return { createdKey: null, mealSlotsError: error instanceof Error ? error.message : "Meal sections could not be saved" };
    }
  }
  if (data.get("intent") === "revoke") {
    await revokeApiKey(env.DB, session.user.id, String(data.get("keyId")));
    return { createdKey: null };
  }
  const created = await createApiKey(env.DB, { userId: session.user.id, householdId: session.householdId, name: String(data.get("name") || "Assistant access"), environment: env.APP_ENV === "production" ? "live" : "test", scopes: defaultScopes });
  return { createdKey: created.key };
}

interface EditorMealSlot extends MealSlotDefinition { editorKey: string }

function MealSlotEditor({ initialSlots, saved, error }: { initialSlots: MealSlotDefinition[]; saved: boolean; error?: string }) {
  const [slots, setSlots] = useState<EditorMealSlot[]>(() => initialSlots.map((slot) => ({ ...slot, editorKey: slot.id })));
  const move = (index: number, offset: number) => setSlots((current) => {
    const target = index + offset;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  return <Form method="post" className="meal-slot-form">
    <div className="meal-slot-editor">
      {slots.map((slot, index) => <div className="meal-slot-setting" key={slot.editorKey}>
        <input type="hidden" name="mealSlotId" value={slot.id} />
        <Input name="mealSlotLabel" value={slot.label} maxLength={32} required aria-label={`Meal section ${index + 1}`} onChange={(event) => setSlots((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} />
        <Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${slot.label || "section"} up`} title="Move up"><ArrowUp size={16} /></Button>
        <Button type="button" variant="ghost" size="icon" disabled={index === slots.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${slot.label || "section"} down`} title="Move down"><ArrowDown size={16} /></Button>
        <Button type="button" variant="ghost" size="icon" disabled={slots.length === 1} onClick={() => setSlots((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${slot.label || "section"}`} title="Remove section"><Trash2 size={16} /></Button>
      </div>)}
    </div>
    <div className="meal-slot-actions">
      <Button type="button" variant="secondary" disabled={slots.length >= maximumMealSlots} onClick={() => setSlots((current) => [...current, { id: "", label: "", editorKey: `new-${crypto.randomUUID()}` }])}><Plus size={16} /> Add section</Button>
      <div>{error ? <span className="form-error" role="alert">{error}</span> : saved ? <span className="settings-saved" role="status"><Check size={15} /> Sections saved</span> : null}<Button name="intent" value="meal-slots" type="submit">Save sections</Button></div>
    </div>
  </Form>;
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div className="page-shell"><header className="page-header"><div><p className="eyebrow">Household</p><h1>Settings</h1><p className="page-subtitle">Manage family defaults and external access.</p></div></header>
      <div className="settings-list"><section><Users size={20} /><div><h2>Family members</h2><p>Owner household; invitations arrive in a later checkpoint.</p></div></section></div>
      <section className="measurement-section" aria-labelledby="measurement-heading">
        <div className="section-heading"><div><p className="eyebrow">Recipe and shopping display</p><h2 id="measurement-heading">Measurements</h2></div><Ruler size={20} /></div>
        <Form method="post" className="measurement-form">
          <fieldset className="measurement-options">
            <legend>Preferred measurement system</legend>
            <label><input type="radio" name="measurementSystem" value="original" defaultChecked={loaderData.measurementSystem === "original"} /><span><strong>Original</strong><small>Keep recipe source units</small></span></label>
            <label><input type="radio" name="measurementSystem" value="metric" defaultChecked={loaderData.measurementSystem === "metric"} /><span><strong>Metric (EU)</strong><small>Grams, kilograms, and liters</small></span></label>
            <label><input type="radio" name="measurementSystem" value="us" defaultChecked={loaderData.measurementSystem === "us"} /><span><strong>US customary</strong><small>Ounces, pounds, cups, and spoons</small></span></label>
          </fieldset>
          <div className="measurement-actions">
            {loaderData.settingsSaved === "measurements" ? <span className="settings-saved" role="status"><Check size={15} /> Preference saved</span> : <span />}
            <Button name="intent" value="measurement" type="submit">Save measurements</Button>
          </div>
        </Form>
      </section>
      <section className="meal-slot-section" aria-labelledby="meal-slot-heading">
        <div className="section-heading"><div><p className="eyebrow">Weekly plan structure</p><h2 id="meal-slot-heading">Meal sections</h2></div><UtensilsCrossed size={20} /></div>
        <MealSlotEditor initialSlots={loaderData.mealSlots} saved={loaderData.settingsSaved === "meal-slots"} error={actionData?.mealSlotsError} />
      </section>
      <section className="api-key-section"><div className="section-heading"><div><p className="eyebrow">Developer access</p><h2>API keys</h2></div><KeyRound size={20} /></div>
        {actionData?.createdKey ? <div className="key-reveal" role="status"><strong>Store this key now. It will not be shown again.</strong><code>{actionData.createdKey}</code></div> : null}
        <Form method="post" className="key-form"><Input name="name" placeholder="Claude Code or family dashboard" aria-label="API key name" /><Button type="submit">Create API key</Button></Form>
        <div className="key-list">{loaderData.keys.map((key) => <div className="key-row" key={key.id}><div><strong>{key.name}</strong><code>{key.prefix}...</code><small>{key.scopes.join(", ")}</small></div><span>{key.revokedAt ? "Revoked" : key.lastUsedAt ? `Used ${key.lastUsedAt}` : "Never used"}</span>{!key.revokedAt ? <Form method="post"><input type="hidden" name="keyId" value={key.id} /><Button name="intent" value="revoke" variant="ghost" size="icon" aria-label={`Revoke ${key.name}`}><Trash2 size={16} /></Button></Form> : null}</div>)}</div>
      </section>
    </div>
  );
}

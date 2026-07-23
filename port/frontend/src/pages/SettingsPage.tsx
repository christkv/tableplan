import { ArrowDown, ArrowUp, Check, Clock3, KeyRound, Mail, Plus, Ruler, ShieldCheck, Trash2, UserPlus, UtensilsCrossed, Users } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ApiKeyView,
  ApiClientError,
  cachedRequest,
  errorMessage,
  Household,
  HouseholdChoice,
  Invitation,
  json,
  Preferences,
  remove,
  request,
  Session,
  put,
} from "../api";
import { Button, Input, Select } from "../components/ui";
import { useSession } from "../session";

const defaultScopes = ["recipes:read", "plans:read", "plans:write", "shopping:read", "shopping:write", "household:read"];

export function SettingsPage() {
  const { setSession } = useSession();
  const [preferences, setPreferences] = useState<Preferences>();
  const [household, setHousehold] = useState<Household>();
  const [households, setHouseholds] = useState<HouseholdChoice[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [slots, setSlots] = useState<Array<{ id: string; label: string; editorKey: string }>>([]);
  const [createdKey, setCreatedKey] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const [prefs, currentHousehold, choices, apiKeys, pendingInvitations] = await Promise.all([
        cachedRequest<Preferences>("/api/v1/preferences"),
        cachedRequest<Household>("/api/v1/household", 10_000),
        cachedRequest<HouseholdChoice[]>("/api/v1/households", 10_000),
        cachedRequest<ApiKeyView[]>("/api/v1/api-keys", 10_000),
        request<Invitation[]>("/api/v1/household/invitations").catch((cause) => {
          if (cause instanceof ApiClientError && cause.status === 403) return [];
          throw cause;
        }),
      ]);
      setPreferences(prefs);
      setHousehold(currentHousehold);
      setHouseholds(choices);
      setKeys(apiKeys);
      setSlots(prefs.mealSlots.map((slot) => ({ ...slot, editorKey: slot.id })));
      setInvitations(pendingInvitations);
    } catch (cause) { setError(errorMessage(cause, "Settings could not be loaded.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function switchHousehold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const householdId = String(new FormData(event.currentTarget).get("householdId"));
    const next = await request<Session>("/api/auth/switch-household", json({ householdId }));
    setSession(next);
    setMessage("Household switched.");
    await load();
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const created = await request<Invitation>("/api/v1/household/invitations", json({ email: data.get("email"), role: data.get("role"), relationship: data.get("relationship") }));
      setInviteLink(`${location.origin}/household/join#invite=${encodeURIComponent(created.token ?? "")}`);
      setMessage(`Invitation created for ${created.email}.`);
      setInvitations(await request("/api/v1/household/invitations"));
      event.currentTarget.reset();
    } catch (cause) { setError(errorMessage(cause, "Invitation could not be created.")); }
  }
  async function revokeInvitation(id: string) {
    await request(`/api/v1/household/invitations/${id}`, remove());
    setInvitations((current) => current.filter((item) => item.id !== id));
  }
  async function measurement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("measurementSystem"));
    setPreferences(await request("/api/v1/preferences/measurement", put({ measurementSystem: value })));
    setMessage("Measurement preference saved.");
  }
  async function saveSlots(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = await request<Preferences>("/api/v1/preferences/meal-slots", put({ mealSlots: slots.map(({ id, label }) => ({ id, label })) }));
    setPreferences(next);
    setSlots(next.mealSlots.map((slot) => ({ ...slot, editorKey: slot.id })));
    setMessage("Meal sections saved.");
  }
  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const created = await request<{ id: string; key: string }>("/api/v1/api-keys", json({ name: data.get("name") || "Assistant access", environment: data.get("environment"), scopes: data.getAll("scope") }));
    setCreatedKey(created.key);
    setKeys(await request("/api/v1/api-keys"));
    event.currentTarget.reset();
  }
  async function revokeKey(id: string) {
    await request(`/api/v1/api-keys/${id}`, remove());
    setKeys(await request("/api/v1/api-keys"));
  }
  function moveSlot(index: number, offset: number) {
    setSlots((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  if (!preferences || !household) return <div className="page-shell"><p className="recipe-load-sentinel">Loading settings…</p>{error && <p className="form-error">{error}</p>}</div>;
  return <div className="page-shell">
    <header className="page-header"><div><p className="eyebrow">Household</p><h1>Settings</h1><p className="page-subtitle">Manage family defaults and external access.</p></div></header>
    {message && <p className="settings-saved" role="status"><Check size={15} /> {message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="household-section"><div className="section-heading"><div><p className="eyebrow">{household.name}</p><h2>Household members</h2></div><Users size={20} /></div>
      {households.length > 1 && <form className="household-switcher" onSubmit={switchHousehold}><label>Active household<Select name="householdId" defaultValue={household.id}>{households.map((choice) => <option value={choice.id} key={choice.id}>{choice.name}</option>)}</Select></label><Button variant="secondary">Switch</Button></form>}
      <div className="household-member-list">{household.members.map((member) => <div className="household-member-row" key={member.userId}><div className="member-avatar">{member.name.slice(0, 1).toUpperCase()}</div><div><strong>{member.name}</strong><small>{member.email}</small></div><div className="member-meta"><span>{member.role === "owner" ? <><ShieldCheck size={14} /> Owner</> : member.role}</span><small>{member.relationship}</small></div></div>)}</div>
      {["owner", "adult"].includes(household.currentRole) ? <><form className="household-invite-form" onSubmit={invite}><div><label>Email<Input name="email" type="email" required placeholder="person@example.com" /></label></div><div><label>Relationship<Select name="relationship" defaultValue="spouse"><option value="spouse">Spouse or partner</option><option value="child">Child</option><option value="flatmate">Flatmate</option><option value="other">Other</option></Select></label></div><div><label>Access<Select name="role" defaultValue={household.currentRole === "owner" ? "adult" : "viewer"}>{household.currentRole === "owner" && <option value="adult">Adult member</option>}<option value="viewer">Viewer</option></Select></label></div><Button><UserPlus size={16} /> Create invite</Button></form>
        {inviteLink && <div className="invite-link-capture"><strong>Single-use invitation link</strong><a href={inviteLink}>{inviteLink}</a><small>Copy this private credential now.</small></div>}
        {!!invitations.length && <div className="pending-invitations"><h3>Pending invitations</h3>{invitations.map((invitation) => <div className="pending-invitation-row" key={invitation.id}><Mail size={17} /><div><strong>{invitation.email}</strong><small>{invitation.relationship} · {invitation.role}</small></div><span className={new Date(invitation.expiresAt) <= new Date() ? "invite-expired" : ""}><Clock3 size={13} /> {new Date(invitation.expiresAt) <= new Date() ? "Expired" : invitation.deliveryStatus ?? "pending"}</span><Button variant="ghost" size="icon" onClick={() => revokeInvitation(invitation.id)}><Trash2 size={16} /></Button></div>)}</div>}
      </> : <p className="household-permission-note">Only household managers can invite new members.</p>}
    </section>
    <section className="measurement-section"><div className="section-heading"><div><p className="eyebrow">Recipe and shopping display</p><h2>Measurements</h2></div><Ruler size={20} /></div><form className="measurement-form" onSubmit={measurement}><fieldset className="measurement-options"><legend>Preferred measurement system</legend>{([["original", "Original", "Keep recipe source units"], ["metric", "Metric (EU)", "Grams, kilograms, and liters"], ["us", "US customary", "Ounces, pounds, cups, and spoons"]] as const).map(([value, label, detail]) => <label key={value}><input type="radio" name="measurementSystem" value={value} defaultChecked={preferences.measurementSystem === value} /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</fieldset><div className="measurement-actions"><span /><Button>Save measurements</Button></div></form></section>
    <section className="meal-slot-section"><div className="section-heading"><div><p className="eyebrow">Weekly plan structure</p><h2>Meal sections</h2></div><UtensilsCrossed size={20} /></div><form className="meal-slot-form" onSubmit={saveSlots}><div className="meal-slot-editor">{slots.map((slot, index) => <div className="meal-slot-setting" key={slot.editorKey}><Input value={slot.label} maxLength={32} required onChange={(event) => setSlots((current) => current.map((item, position) => position === index ? { ...item, label: event.target.value } : item))} /><Button type="button" variant="ghost" size="icon" disabled={!index} onClick={() => moveSlot(index, -1)}><ArrowUp size={16} /></Button><Button type="button" variant="ghost" size="icon" disabled={index === slots.length - 1} onClick={() => moveSlot(index, 1)}><ArrowDown size={16} /></Button><Button type="button" variant="ghost" size="icon" disabled={slots.length === 1} onClick={() => setSlots((current) => current.filter((_, position) => position !== index))}><Trash2 size={16} /></Button></div>)}</div><div className="meal-slot-actions"><Button type="button" variant="secondary" disabled={slots.length >= 8} onClick={() => setSlots((current) => [...current, { id: "", label: "", editorKey: crypto.randomUUID() }])}><Plus size={16} /> Add section</Button><Button>Save sections</Button></div></form></section>
    <section className="api-key-section"><div className="section-heading"><div><p className="eyebrow">Developer access</p><h2>API keys</h2></div><KeyRound size={20} /></div>
      {createdKey && <div className="key-reveal" role="status"><strong>Store this key now. It will not be shown again.</strong><code>{createdKey}</code></div>}
      <form className="key-form key-create-form" onSubmit={createKey}><Input name="name" required placeholder="Claude Code or family dashboard" /><Select name="environment" defaultValue="test"><option value="test">Test</option><option value="live">Live</option></Select><fieldset className="scope-options"><legend>Scopes</legend>{defaultScopes.map((scope) => <label key={scope}><input type="checkbox" name="scope" value={scope} defaultChecked />{scope}</label>)}</fieldset><Button>Create API key</Button></form>
      <div className="key-list">{keys.map((key) => <div className="key-row" key={key.id}><div><strong>{key.name}</strong><code>{key.prefix}…</code><small>{key.scopes.join(", ")}</small></div><span>{key.revokedAt ? "Revoked" : key.lastUsedAt ? `Used ${new Date(key.lastUsedAt).toLocaleDateString()}` : "Never used"}</span>{!key.revokedAt && <Button variant="ghost" size="icon" onClick={() => revokeKey(key.id)}><Trash2 size={16} /></Button>}</div>)}</div>
    </section>
  </div>;
}

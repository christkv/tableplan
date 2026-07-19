import { APIError } from "better-auth";
import { ChefHat, LoaderCircle, LogOut, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Form, Link, data, redirect } from "react-router";

import type { Route } from "./+types/household-join";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { authClient } from "~/lib/auth-client";
import { cloudflareContext } from "../context";
import { createAuth } from "../../src/auth/server";
import {
  acceptHouseholdInvitation,
  clearInvitationCookie,
  invitationSecurityHeaders,
  readInvitationCookie,
  resolveHouseholdInvitation,
} from "../../src/households/invitations";

export function headers() { return invitationSecurityHeaders(); }

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const token = readInvitationCookie(request);
  const invitation = token ? await resolveHouseholdInvitation(env.DB, token) : null;
  const session = await createAuth(env, ctx).api.getSession({ headers: request.headers });
  return {
    invitation,
    user: session ? { id: session.user.id, name: session.user.name, email: session.user.email } : null,
  };
}

function authErrorMessage(error: unknown): string {
  if (error instanceof APIError) return error.body?.message ?? error.message ?? "Account creation failed.";
  return error instanceof Error ? error.message : "Account creation failed.";
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return data({ error: "Invalid request origin." }, { status: 403 });
  const token = readInvitationCookie(request);
  const invitation = token ? await resolveHouseholdInvitation(env.DB, token) : null;
  if (!invitation) return data({ error: "This invitation has expired or was already used." }, { status: 410 });
  const form = await request.formData();
  const auth = createAuth(env, ctx);
  const session = await auth.api.getSession({ headers: request.headers });
  try {
    if (session) {
      await acceptHouseholdInvitation(env.DB, invitation, session.user);
      const responseHeaders = new Headers();
      responseHeaders.append("Set-Cookie", clearInvitationCookie(env.APP_ENV !== "local"));
      return redirect("/recipes?joined=household", { headers: responseHeaders });
    }
    if (invitation.existingAccount) {
      return redirect("/sign-in?returnTo=%2Fhousehold%2Fjoin");
    }
    const name = String(form.get("name") ?? "").trim();
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (name.length < 2 || name.length > 80) return data({ error: "Enter your full name." }, { status: 400 });
    if (username.length < 3 || username.length > 32) return data({ error: "Username must be 3 to 32 characters." }, { status: 400 });
    if (password.length < 8 || password.length > 128) return data({ error: "Password must be 8 to 128 characters." }, { status: 400 });
    if (password !== confirmPassword) return data({ error: "Passwords do not match." }, { status: 400 });
    const created = await auth.api.signUpEmail({
      returnHeaders: true,
      headers: request.headers,
      body: { name, email: invitation.email, username, password },
    });
    if (!created.response.user) throw new Error("The account could not be created.");
    await acceptHouseholdInvitation(env.DB, invitation, created.response.user);
    const responseHeaders = new Headers();
    for (const cookie of created.headers.getSetCookie()) responseHeaders.append("Set-Cookie", cookie);
    responseHeaders.append("Set-Cookie", clearInvitationCookie(env.APP_ENV !== "local"));
    return redirect("/recipes?joined=household", { headers: responseHeaders });
  } catch (error) {
    return data({ error: authErrorMessage(error) }, { status: error instanceof APIError ? 400 : 409 });
  }
}

export default function HouseholdJoin({ loaderData, actionData }: Route.ComponentProps) {
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(!loaderData.invitation);
  const invitation = loaderData.invitation;

  useEffect(() => {
    if (invitation) { setExchanging(false); return; }
    const token = new URLSearchParams(window.location.hash.slice(1)).get("invite");
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!token) { setExchanging(false); return; }
    void fetch("/api/public/household-invitations/exchange", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).then(async (response) => {
      if (!response.ok) throw new Error("This invitation has expired or was revoked.");
      window.location.replace("/household/join");
    }).catch((reason: unknown) => {
      setExchanging(false);
      setExchangeError(reason instanceof Error ? reason.message : "The invitation could not be opened.");
    });
  }, [invitation]);

  async function signOut() {
    await authClient.signOut();
    window.location.reload();
  }

  if (exchanging) return <main className="shared-loading"><div><span className="brand-mark"><Users size={20} /></span><LoaderCircle className="spin" size={24} /><h1>Opening your invitation</h1><p>Checking the private household link.</p></div></main>;
  if (!invitation) return <main className="shared-loading"><div><span className="brand-mark"><Users size={20} /></span><h1>Invitation unavailable</h1><p>{exchangeError ?? "This link is incomplete, expired, or has already been used."}</p><Link className="button button-secondary button-default" to="/sign-in">Go to sign in</Link></div></main>;

  const signedInWithInvitedEmail = loaderData.user?.email.toLowerCase() === invitation.email;
  return <main className="invite-page">
    <header className="invite-brand"><Link to="/sign-in" className="brand"><span className="brand-mark"><ChefHat size={20} /></span><span>Tableplan</span></Link></header>
    <section className="invite-panel">
      <p className="eyebrow">Household invitation</p>
      <h1>Join {invitation.householdName}</h1>
      <p><strong>{invitation.inviterName}</strong> invited <strong>{invitation.email}</strong> to plan and shop with their household.</p>
      <dl className="invite-details"><div><dt>Relationship</dt><dd>{invitation.relationship}</dd></div><div><dt>Access</dt><dd>Household member</dd></div></dl>
      {loaderData.user && !signedInWithInvitedEmail ? <div className="invite-state"><p>You are signed in as <strong>{loaderData.user.email}</strong>. This invitation is for <strong>{invitation.email}</strong>.</p><Button variant="secondary" onClick={signOut}><LogOut size={16} /> Sign out</Button></div>
        : signedInWithInvitedEmail ? <Form method="post" className="invite-form"><p>Continue as <strong>{loaderData.user?.name}</strong> to join this household.</p>{actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}<Button type="submit"><Users size={17} /> Join household</Button></Form>
          : invitation.existingAccount ? <div className="invite-state"><p>An account already exists for this email. Sign in to accept the invitation.</p><Link className="button button-primary button-default" to="/sign-in?returnTo=%2Fhousehold%2Fjoin">Sign in to join</Link></div>
            : <Form method="post" className="invite-form">
              <label>Full name<Input name="name" required minLength={2} maxLength={80} autoComplete="name" /></label>
              <label>Username<Input name="username" required minLength={3} maxLength={32} autoComplete="username" /></label>
              <label>Email<Input value={invitation.email} readOnly aria-readonly="true" /></label>
              <label>Password<Input name="password" required type="password" minLength={8} maxLength={128} autoComplete="new-password" /></label>
              <label>Confirm password<Input name="confirmPassword" required type="password" minLength={8} maxLength={128} autoComplete="new-password" /></label>
              {actionData?.error ? <p className="form-error" role="alert">{actionData.error}</p> : null}
              <Button type="submit">Create account and join</Button>
            </Form>}
      <small>The invitation is single-use and expires {new Date(invitation.expiresAt).toLocaleDateString()}.</small>
    </section>
  </main>;
}

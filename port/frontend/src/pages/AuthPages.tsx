import { Globe, LoaderCircle, LogOut, Users } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiClientError, errorMessage, Invitation, json, request, Session } from "../api";
import { Button, Input } from "../components/ui";
import { BrandMark, BrandName, PRODUCT_NAME } from "../components/Brand";
import { safeReturnTo } from "../lib/domain";
import { useSession } from "../session";

export function SignInPage({ initialMode = "sign-in" }: { initialMode?: "sign-in" | "sign-up" }) {
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const googleAuthorizationUrl =
    `/oauth2/authorization/google` +
    `?returnTo=${encodeURIComponent(returnTo)}`;
  const [mode, setMode] = useState(initialMode);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verificationRequired, setVerificationRequired] = useState(false);
  const { setSession } = useSession();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setError("");
    setNotice("");
    setVerificationRequired(false);
    const data = new FormData(event.currentTarget);
    try {
      const body = mode === "sign-up"
        ? {
            name: String(data.get("name") ?? "").trim(),
            email: String(data.get("identity") ?? "").trim(),
            username: String(data.get("username") ?? "").trim(),
            password: String(data.get("password") ?? ""),
          }
        : {
            identifier: String(data.get("identity") ?? "").trim(),
            password: String(data.get("password") ?? ""),
          };
      if (mode === "sign-up") {
        const result = await request<{ message: string }>("/api/auth/register", json(body));
        setNotice(result.message);
        setMode("sign-in");
        form.reset();
      } else {
        const next = await request<Session>("/api/auth/login", json(body));
        setSession(next);
        window.location.assign(returnTo);
      }
    } catch (cause) {
      setVerificationRequired(cause instanceof ApiClientError && cause.code === "email_verification_required");
      setError(errorMessage(cause, "Authentication failed."));
    } finally {
      setPending(false);
    }
  }
  return <main className="auth-page">
    <section className="auth-brand-panel">
      <Link to="/sign-in" className="brand auth-brand"><BrandMark /><BrandName /></Link>
      <div className="auth-brand-copy"><p className="eyebrow">Your week, in rhythm</p><h1>Make the week easier for everyone at the table.</h1><p>Keep the recipes you love, shape a plan that fits, and turn it into one useful shopping list.</p></div>
      <small>Plan the week · Shop once · Eat together</small>
    </section>
    <section className="auth-form-panel"><div className="auth-form-wrap">
      <p className="eyebrow">{mode === "sign-in" ? "Welcome back" : "Create your household"}</p>
      <h2>{mode === "sign-in" ? `Sign in to ${PRODUCT_NAME}` : "Start your weekly rhythm"}</h2>
      <p>{mode === "sign-in" ? "Use your email, username, or Google account." : "Your first account becomes the household owner."}</p>
      {notice && <p className="form-success" role="status">{notice}</p>}
      <a className="button button-secondary button-default google-button" href={googleAuthorizationUrl}><Globe size={18} /> Continue with Google</a>
      <div className="auth-divider"><span>or</span></div>
      <form onSubmit={submit} className="auth-form">
        {mode === "sign-up" && <><label>Full name<Input name="name" required minLength={2} maxLength={100} autoComplete="name" /></label><label>Username<Input name="username" required minLength={3} maxLength={32} autoComplete="username" /></label></>}
        <label>{mode === "sign-in" ? "Email or username" : "Email"}<Input name="identity" required type={mode === "sign-up" ? "email" : "text"} autoComplete={mode === "sign-up" ? "email" : "username"} /></label>
        <label>Password<Input name="password" required type="password" minLength={12} maxLength={200} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} /></label>
        {mode === "sign-in" && <Link className="auth-help-link" to="/forgot-password">Forgot your password?</Link>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {verificationRequired && <Link className="auth-help-link" to="/verify-email">Request a new confirmation email</Link>}
        <Button type="submit" disabled={pending}>{pending && <LoaderCircle className="spin" size={17} />}{mode === "sign-in" ? "Sign in" : "Create account"}</Button>
      </form>
      <button type="button" className="auth-mode" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(""); }}>{mode === "sign-in" ? "New here? Create an account" : "Already have an account? Sign in"}</button>
    </div></section>
  </main>;
}

function tokenFromHash(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
}

function AuthActionShell({ eyebrow, title, children }: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return <main className="auth-action-page"><section className="auth-action-card">
    <Link to="/sign-in" className="brand auth-action-brand"><BrandMark /><BrandName /></Link>
    <p className="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    {children}
  </section></main>;
}

export function VerifyEmailPage() {
  const [token] = useState(tokenFromHash);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
  }, []);
  async function confirm() {
    setPending(true);
    setError("");
    try {
      const result = await request<{ message: string }>("/api/auth/email-verification/confirm", json({ token }));
      setMessage(result.message);
    } catch (cause) {
      setError(errorMessage(cause, "The confirmation link is invalid or expired."));
    } finally {
      setPending(false);
    }
  }
  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    try {
      const result = await request<{ message: string }>("/api/auth/email-verification/request", json({ email }));
      setMessage(result.message);
    } catch (cause) {
      setError(errorMessage(cause, "A confirmation email could not be requested."));
    } finally {
      setPending(false);
    }
  }
  return <AuthActionShell eyebrow="Account security" title="Confirm your email">
    {message ? <><p className="form-success" role="status">{message}</p><Link className="button button-primary button-default" to="/sign-in">Continue to sign in</Link></>
      : token ? <><p>Confirm this email address to activate password sign-in.</p><Button onClick={confirm} disabled={pending}>{pending && <LoaderCircle className="spin" size={17} />}Confirm email</Button></>
        : <><p>Enter your registration email and we will send a new confirmation link.</p><form className="auth-form" onSubmit={resend}><label>Email<Input name="email" type="email" required autoComplete="email" /></label><Button type="submit" disabled={pending}>Send confirmation email</Button></form></>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </AuthActionShell>;
}

export function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    try {
      const result = await request<{ message: string }>("/api/auth/password-reset/request", json({ email }));
      setMessage(result.message);
    } catch (cause) {
      setError(errorMessage(cause, "The reset email could not be requested."));
    } finally {
      setPending(false);
    }
  }
  return <AuthActionShell eyebrow="Account recovery" title="Reset your password">
    <p>Enter your account email. For privacy, the response is the same whether or not an account exists.</p>
    {message ? <p className="form-success" role="status">{message}</p>
      : <form className="auth-form" onSubmit={submit}><label>Email<Input name="email" type="email" required autoComplete="email" /></label><Button type="submit" disabled={pending}>{pending && <LoaderCircle className="spin" size={17} />}Send reset email</Button></form>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <Link className="auth-help-link" to="/sign-in">Return to sign in</Link>
  </AuthActionShell>;
}

export function ResetPasswordPage() {
  const [token] = useState(tokenFromHash);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setPending(true);
    try {
      const result = await request<{ message: string }>("/api/auth/password-reset/confirm", json({ token, password }));
      setMessage(result.message);
    } catch (cause) {
      setError(errorMessage(cause, "The reset link is invalid or expired."));
    } finally {
      setPending(false);
    }
  }
  return <AuthActionShell eyebrow="Account recovery" title="Choose a new password">
    {!token ? <p className="form-error" role="alert">This password reset link is incomplete.</p>
      : message ? <><p className="form-success" role="status">{message}</p><Link className="button button-primary button-default" to="/sign-in">Continue to sign in</Link></>
        : <form className="auth-form" onSubmit={submit}><label>New password<Input name="password" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></label><label>Confirm new password<Input name="confirmation" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></label><Button type="submit" disabled={pending}>{pending && <LoaderCircle className="spin" size={17} />}Reset password</Button></form>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </AuthActionShell>;
}

const authMessages: Record<string, [string, string]> = {
  access_denied: ["Google sign-in was cancelled", "No changes were made. Return to sign in and try again."],
  account_not_linked: ["This Google account is not linked", "Sign in using your existing method before linking Google."],
  email_not_found: ["Google did not provide an email address", "Choose an account with an available email address."],
  invalid_code: ["The Google sign-in link expired", "Start a new Google sign-in. Callback links cannot be reused."],
  state_mismatch: ["The sign-in session expired", "Start again and make sure cookies are enabled."],
  oauth_account_invalid: ["The linked Google account is unavailable", "Contact the administrator or use another sign-in method."],
  oauth_email_invalid: ["Google returned an invalid email", "Choose a Google account with a valid email address."],
  oauth_email_unverified: ["Your Google email is not verified", "Verify the email on your Google account before signing in."],
  oauth_link_conflict: ["This Google account is already linked", "Use the account that originally linked this Google identity."],
  oauth_provider_invalid: ["The Google sign-in response was invalid", "Return to sign in and start a new Google login."],
  oauth_subject_invalid: ["Google did not return an account identity", "Return to sign in and try another Google account."],
};

export function AuthErrorPage() {
  const [params] = useSearchParams();
  const code = (params.get("error") ?? params.get("code"))?.match(/^[A-Za-z0-9_-]{1,128}$/)?.[0] ?? "unknown_error";
  const requestId = params.get("request_id")?.match(/^[A-Za-z0-9_-]{1,128}$/)?.[0] ?? "not-available";
  const [title, detail] = authMessages[code] ?? ["Authentication failed", "The sign-in request could not be completed. Return to sign in and try again."];
  return <main className="error-page"><div><BrandMark /><p className="eyebrow">{PRODUCT_NAME} authentication</p><h1>{title}</h1><p>{detail}</p><p className="error-reference"><strong>Error:</strong> {code}<br /><strong>Reference:</strong> {requestId}</p><Link to="/sign-in">Return to sign in</Link></div></main>;
}

export function HouseholdJoinPage() {
  const navigate = useNavigate();
  const { session, setSession } = useSession();
  const [token] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1)).get("invite");
    return hash ?? new URLSearchParams(window.location.search).get("token") ?? "";
  });
  const [invitation, setInvitation] = useState<Invitation | null>();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    history.replaceState(null, "", window.location.pathname);
    if (!token) { setInvitation(null); return; }
    request<Invitation>(`/api/public/household-invitations/${encodeURIComponent(token)}`)
      .then(setInvitation).catch((cause) => { setError(errorMessage(cause, "This invitation is unavailable.")); setInvitation(null); });
  }, [token]);
  async function accept() {
    setPending(true);
    try {
      const accepted = await request<{ householdId: string }>(`/api/v1/household-invitations/${encodeURIComponent(token)}/accept`, json({}));
      const next = await request<Session>("/api/auth/switch-household", json(accepted));
      setSession(next);
      navigate("/recipes?joined=household");
    } catch (cause) { setError(errorMessage(cause, "The invitation could not be accepted.")); }
    finally { setPending(false); }
  }
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invitation) return;
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const body = mode === "sign-up"
        ? { name: String(data.get("name") ?? ""), username: String(data.get("username") ?? ""), email: invitation.email, password: String(data.get("password") ?? "") }
        : { identifier: invitation.email, password: String(data.get("password") ?? "") };
      const next = await request<Session>(`/api/auth/${mode === "sign-up" ? "register" : "login"}`, json(body));
      setSession(next);
      await accept();
    } catch (cause) { setError(errorMessage(cause, "Authentication failed.")); }
    finally { setPending(false); }
  }
  async function signOut() {
    await request("/api/auth/logout", json({}));
    setSession(null);
  }
  if (invitation === undefined) return <main className="shared-loading"><div><span className="brand-mark"><Users size={20} /></span><LoaderCircle className="spin" size={24} /><h1>Opening your invitation</h1><p>Checking the private household link.</p></div></main>;
  if (!invitation) return <main className="shared-loading"><div><span className="brand-mark"><Users size={20} /></span><h1>Invitation unavailable</h1><p>{error || "This link is incomplete, expired, or already used."}</p><Link className="button button-secondary button-default" to="/sign-in">Go to sign in</Link></div></main>;
  const matching = session?.user.email.toLowerCase() === invitation.email.toLowerCase();
  return <main className="invite-page">
    <header className="invite-brand"><Link to="/sign-in" className="brand"><BrandMark /><BrandName /></Link></header>
    <section className="invite-panel"><p className="eyebrow">Household invitation</p><h1>Join {invitation.householdName}</h1><p>You were invited as <strong>{invitation.role}</strong> using <strong>{invitation.email}</strong>.</p>
      <dl className="invite-details"><div><dt>Access</dt><dd>{invitation.role}</dd></div><div><dt>Expires</dt><dd>{new Date(invitation.expiresAt).toLocaleDateString()}</dd></div></dl>
      {session && !matching ? <div className="invite-state"><p>You are signed in as <strong>{session.user.email}</strong>. This invitation belongs to another account.</p><Button variant="secondary" onClick={signOut}><LogOut size={16} /> Sign out</Button></div>
        : matching ? <div className="invite-form"><p>Continue as <strong>{session?.user.name}</strong> to join this household.</p><Button onClick={accept} disabled={pending}><Users size={17} /> Join household</Button></div>
          : <form className="invite-form" onSubmit={authenticate}>
            <div className="source-mode-tabs"><button type="button" className={mode === "sign-in" ? "active" : ""} onClick={() => setMode("sign-in")}>Existing account</button><button type="button" className={mode === "sign-up" ? "active" : ""} onClick={() => setMode("sign-up")}>Create account</button></div>
            {mode === "sign-up" && <><label>Full name<Input name="name" required minLength={2} /></label><label>Username<Input name="username" required minLength={3} maxLength={32} /></label></>}
            <label>Email<Input value={invitation.email} readOnly /></label><label>Password<Input name="password" type="password" required minLength={12} /></label>
            <Button type="submit" disabled={pending}>{mode === "sign-up" ? "Create account and join" : "Sign in and join"}</Button>
          </form>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  </main>;
}

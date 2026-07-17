import { ChefHat, Globe, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { authClient } from "~/lib/auth-client";

export default function SignIn() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(null);
    const data = new FormData(event.currentTarget);
    const identity = String(data.get("identity") ?? "").trim();
    const password = String(data.get("password") ?? "");
    try {
      const result = mode === "sign-up"
        ? await authClient.signUp.email({
            name: String(data.get("name") ?? "").trim(),
            email: identity,
            username: String(data.get("username") ?? "").trim(),
            password,
          })
        : identity.includes("@")
          ? await authClient.signIn.email({ email: identity, password })
          : await authClient.signIn.username({ username: identity, password });
      if (result.error) setError(result.error.message ?? "Authentication failed");
      else window.location.assign("/recipes");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed");
    } finally {
      setPending(false);
    }
  }

  async function signInWithGoogle() {
    setPending(true); setError(null);
    const result = await authClient.signIn.social({ provider: "google", callbackURL: "/recipes" });
    if (result?.error) { setError(result.error.message ?? "Google sign-in failed"); setPending(false); }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Link to="/sign-in" className="brand auth-brand"><span className="brand-mark"><ChefHat size={20} /></span><span>Tableplan</span></Link>
        <div><p className="eyebrow">Dinner, decided</p><h1>Make the week easier for everyone at the table.</h1><p>Save family favorites, scale every recipe, and turn the plan into one useful shopping list.</p></div>
        <small>Private household planning with clear quantities.</small>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <p className="eyebrow">{mode === "sign-in" ? "Welcome back" : "Create your household"}</p>
          <h2>{mode === "sign-in" ? "Sign in to Tableplan" : "Start planning meals"}</h2>
          <p>{mode === "sign-in" ? "Use your email, username, or Google account." : "Your first account becomes the household owner."}</p>
          <Button variant="secondary" className="google-button" onClick={signInWithGoogle} disabled={pending}><Globe size={18} /> Continue with Google</Button>
          <div className="auth-divider"><span>or</span></div>
          <form onSubmit={submit} className="auth-form">
            {mode === "sign-up" ? <><label>Full name<Input name="name" required autoComplete="name" /></label><label>Username<Input name="username" required minLength={3} autoComplete="username" /></label></> : null}
            <label>{mode === "sign-in" ? "Email or username" : "Email"}<Input name="identity" required type={mode === "sign-up" ? "email" : "text"} autoComplete={mode === "sign-up" ? "email" : "username"} /></label>
            <label>Password<Input name="password" required type="password" minLength={8} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} /></label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={17} /> : null}{mode === "sign-in" ? "Sign in" : "Create account"}</Button>
          </form>
          <button type="button" className="auth-mode" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(null); }}>{mode === "sign-in" ? "New here? Create an account" : "Already have an account? Sign in"}</button>
        </div>
      </section>
    </main>
  );
}

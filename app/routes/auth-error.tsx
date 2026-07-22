import { Link } from "react-router";

import type { Route } from "./+types/auth-error";
import { cloudflareContext } from "../context";
import { createLogger } from "../../src/observability/logger";

const messages: Record<string, { title: string; detail: string }> = {
  access_denied: { title: "Google sign-in was cancelled", detail: "No changes were made. You can return to sign in and try again." },
  account_not_linked: { title: "This Google account is not linked", detail: "Sign in using your existing method, then link Google from your account settings." },
  email_not_found: { title: "Google did not provide an email address", detail: "Choose a Google account with an available email address and try again." },
  gateway_unavailable: { title: "The authentication service is unavailable", detail: "This is usually temporary. Wait a moment, then start a new sign-in." },
  internal_server_error: { title: "Authentication could not be completed", detail: "The server encountered an unexpected authentication error. Please try again." },
  invalid_code: { title: "The Google sign-in link expired", detail: "Return to sign in and start a new Google sign-in. Callback links cannot be reused." },
  state_mismatch: { title: "The sign-in session expired", detail: "Return to sign in and start again. Cookies must be enabled for Google sign-in." },
  unable_to_create_user: { title: "Your account could not be created", detail: "Tableplan could not create or link the account. Please try again; if it continues, share the reference below." },
  unable_to_get_user_info: { title: "Google account details were unavailable", detail: "Return to sign in and try a different Google account or try again later." },
};

function safeValue(value: string | null, fallback: string): string {
  return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : fallback;
}

export function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const url = new URL(request.url);
  const code = safeValue(url.searchParams.get("error"), "unknown_error");
  const requestId = safeValue(url.searchParams.get("request_id"), request.headers.get("cf-ray") ?? crypto.randomUUID());
  createLogger(env, "auth").error("error.presented", { code, requestId });
  return { code, requestId, ...(messages[code] ?? { title: "Authentication failed", detail: "The sign-in request could not be completed. Return to sign in and try again." }) };
}

export default function AuthError({ loaderData }: Route.ComponentProps) {
  return (
    <main className="error-page">
      <div>
        <p className="eyebrow">Tableplan authentication</p>
        <h1>{loaderData.title}</h1>
        <p>{loaderData.detail}</p>
        <p className="error-reference"><strong>Error:</strong> {loaderData.code}<br /><strong>Reference:</strong> {loaderData.requestId}</p>
        <Link to="/sign-in">Return to sign in</Link>
      </div>
    </main>
  );
}

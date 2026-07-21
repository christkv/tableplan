import type { Route } from "./+types/api.public.household-invitation.exchange";
import { cloudflareContext } from "../context";
import { createInvitationCookie, invitationSecurityHeaders } from "../../src/households/invitations";
import { createStorageClient } from "../../src/storage";

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ code: "invalid_origin" }, { status: 403, headers: invitationSecurityHeaders() });
  }
  const body = await request.json().catch(() => null) as { token?: string } | null;
  const invitation = await createStorageClient(env).resolveHouseholdInvitation(body?.token ?? "");
  if (!invitation) {
    return Response.json({ code: "invalid_or_expired_link", message: "This invitation is no longer available." }, { status: 410, headers: invitationSecurityHeaders() });
  }
  const headers = new Headers(invitationSecurityHeaders());
  headers.append("Set-Cookie", createInvitationCookie(body?.token ?? "", invitation.expiresAt, env.APP_ENV !== "local"));
  return Response.json({ invitationId: invitation.id, existingAccount: invitation.existingAccount }, { headers });
}

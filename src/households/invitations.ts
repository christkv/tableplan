import { processHouseholdInvitationEmail, type HouseholdInvitationEmailQueueMessage } from "../email/household-invitation-email";
import { normalizeInvitationEmail, parseHouseholdInviteRole, parseHouseholdRelationship, type HouseholdInviteRole, type HouseholdRelationship } from "../domain/households";
import { createStorageClient } from "../storage";

export {
  HouseholdInvitationError,
  hashInvitationToken,
  householdInviteRoles,
  householdRelationships,
  normalizeInvitationEmail,
  parseHouseholdInviteRole,
  parseHouseholdRelationship,
  randomInvitationToken,
} from "../domain/households";
export type { HouseholdInvitationView, HouseholdInviteRole, HouseholdRelationship } from "../domain/households";

const INVITATION_COOKIE = "tableplan_household_invite";

export async function createHouseholdInvitation(env: CloudflareEnvironment, input: {
  householdId: string;
  invitedByUserId: string;
  email: unknown;
  relationship: unknown;
  role: unknown;
  localBaseUrl?: string;
}) {
  const email = normalizeInvitationEmail(input.email);
  const relationship: HouseholdRelationship = parseHouseholdRelationship(input.relationship);
  const role: HouseholdInviteRole = parseHouseholdInviteRole(input.role);
  const storage = createStorageClient(env);
  const { id, token, expiresAt } = await storage.createHouseholdInvitationRecord({
    householdId: input.householdId,
    invitedByUserId: input.invitedByUserId,
    email,
    relationship,
    role,
  });
  const message = { kind: "household-invitation", invitationId: id, rawToken: token } satisfies HouseholdInvitationEmailQueueMessage;
  if (env.EMAIL_MODE === "cloud") {
    if (!env.EMAIL_DELIVERY_QUEUE) throw new Error("Email delivery is not configured.");
    try {
      await env.EMAIL_DELIVERY_QUEUE.send(message);
      await storage.updateHouseholdInvitationDelivery(id, "queued");
    } catch (error) {
      await storage.updateHouseholdInvitationDelivery(id, "failed", { error: "Invitation email could not be queued" }).catch(() => undefined);
      throw error;
    }
  } else {
    await processHouseholdInvitationEmail(env, message);
  }
  const baseUrl = (env.APP_ENV === "local" && input.localBaseUrl ? input.localBaseUrl : env.PUBLIC_APP_URL ?? env.BETTER_AUTH_URL).replace(/\/$/, "");
  return { id, email, expiresAt, invitationUrl: `${baseUrl}/household/join#invite=${encodeURIComponent(token)}` };
}

export function readInvitationCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === INVITATION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function createInvitationCookie(token: string, expiresAt: string, secure: boolean): string {
  return `${INVITATION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure ? "; Secure" : ""}`;
}

export function clearInvitationCookie(secure: boolean): string {
  return `${INVITATION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function invitationSecurityHeaders(): HeadersInit {
  return {
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

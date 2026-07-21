import { processHouseholdInvitationEmail, type HouseholdInvitationEmailQueueMessage } from "../email/household-invitation-email";
import { HouseholdInvitationError, INVITATION_LIFETIME_DAYS, hashInvitationToken, householdInviteRoles, householdRelationships, normalizeInvitationEmail, parseHouseholdInviteRole, parseHouseholdRelationship, randomInvitationToken, type HouseholdInvitationView, type HouseholdInviteRole, type HouseholdRelationship } from "../domain/households";
import { createStorageClient } from "../storage";
export { HouseholdInvitationError, hashInvitationToken, householdInviteRoles, householdRelationships, normalizeInvitationEmail, parseHouseholdInviteRole, parseHouseholdRelationship, randomInvitationToken } from "../domain/households";
export type { HouseholdInvitationView, HouseholdInviteRole, HouseholdRelationship } from "../domain/households";

const INVITATION_COOKIE = "tableplan_household_invite";

interface InvitationRow {
  id: string;
  household_id: string;
  household_name: string;
  invited_email: string;
  relationship: HouseholdRelationship;
  role: HouseholdInviteRole;
  inviter_name: string;
  expires_at: string;
  created_at: string;
  delivery_status: string;
  existing_account: number;
}

function mapInvitation(row: InvitationRow): HouseholdInvitationView {
  return {
    id: row.id,
    householdId: row.household_id,
    householdName: row.household_name,
    email: row.invited_email,
    relationship: row.relationship,
    role: row.role,
    inviterName: row.inviter_name,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    deliveryStatus: row.delivery_status,
    existingAccount: Boolean(row.existing_account),
  };
}

async function requireHouseholdOwner(db: D1Database, householdId: string, userId: string) {
  const member = await db.prepare("SELECT role FROM household_members WHERE household_id=? AND user_id=?")
    .bind(householdId, userId).first<{ role: string }>();
  if (member?.role !== "owner") {
    throw new HouseholdInvitationError("owner_required", "Only the household owner can manage invitations.");
  }
}

export async function getHouseholdMembers(db: D1Database, householdId: string, userId: string) {
  const current = await db.prepare("SELECT role FROM household_members WHERE household_id=? AND user_id=?")
    .bind(householdId, userId).first<{ role: "owner" | "adult" | "viewer" }>();
  if (!current) throw new HouseholdInvitationError("not_a_member", "Household membership was not found.");
  const [household, members, invitations, availableHouseholds] = await Promise.all([
    db.prepare("SELECT id, name FROM households WHERE id=?").bind(householdId).first<{ id: string; name: string }>(),
    db.prepare(`SELECT hm.user_id, hm.role, hm.relationship, hm.created_at, u.name, u.email
      FROM household_members hm JOIN "user" u ON u.id=hm.user_id
      WHERE hm.household_id=? ORDER BY CASE hm.role WHEN 'owner' THEN 0 WHEN 'adult' THEN 1 ELSE 2 END, lower(u.name)`)
      .bind(householdId).all<{ user_id: string; role: "owner" | "adult" | "viewer"; relationship: HouseholdRelationship; created_at: string; name: string; email: string }>(),
    current.role === "owner"
      ? db.prepare(`SELECT id, invited_email, relationship, role, expires_at, delivery_status, created_at
          FROM household_invitations WHERE household_id=? AND status='pending' ORDER BY created_at DESC`)
        .bind(householdId).all<{ id: string; invited_email: string; relationship: HouseholdRelationship; role: HouseholdInviteRole; expires_at: string; delivery_status: string; created_at: string }>()
      : Promise.resolve({ results: [] }),
    db.prepare(`SELECT h.id, h.name, hm.role FROM household_members hm JOIN households h ON h.id=hm.household_id
      WHERE hm.user_id=? ORDER BY lower(h.name)`).bind(userId)
      .all<{ id: string; name: string; role: "owner" | "adult" | "viewer" }>(),
  ]);
  if (!household) throw new HouseholdInvitationError("household_not_found", "Household was not found.");
  return {
    household,
    currentRole: current.role,
    availableHouseholds: availableHouseholds.results,
    members: members.results.map((member) => ({
      userId: member.user_id,
      name: member.name,
      email: member.email,
      role: member.role,
      relationship: member.relationship,
      joinedAt: member.created_at,
    })),
    invitations: invitations.results.map((invitation) => ({
      id: invitation.id,
      email: invitation.invited_email,
      relationship: invitation.relationship,
      role: invitation.role,
      expiresAt: invitation.expires_at,
      deliveryStatus: invitation.delivery_status,
      createdAt: invitation.created_at,
      expired: Date.parse(invitation.expires_at) <= Date.now(),
    })),
  };
}

export async function switchDefaultHousehold(db: D1Database, userId: string, householdId: string) {
  const membership = await db.prepare("SELECT household_id FROM household_members WHERE household_id=? AND user_id=?")
    .bind(householdId, userId).first<{ household_id: string }>();
  if (!membership) throw new HouseholdInvitationError("not_a_member", "You do not belong to that household.");
  await db.prepare(`INSERT INTO user_profiles (user_id, default_household_id) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET default_household_id=excluded.default_household_id, updated_at=CURRENT_TIMESTAMP`)
    .bind(userId, householdId).run();
}

export async function createHouseholdInvitation(env: CloudflareEnvironment, input: {
  householdId: string;
  invitedByUserId: string;
  email: unknown;
  relationship: unknown;
  role: unknown;
  localBaseUrl?: string;
}) {
  const email = normalizeInvitationEmail(input.email);
  const relationship = parseHouseholdRelationship(input.relationship);
  const role = parseHouseholdInviteRole(input.role);
  const storage = createStorageClient(env);
  const { id, token, expiresAt } = await storage.createHouseholdInvitationRecord({ householdId: input.householdId, invitedByUserId: input.invitedByUserId, email, relationship, role });
  const message = { kind: "household-invitation", invitationId: id, rawToken: token } satisfies HouseholdInvitationEmailQueueMessage;
  if (env.EMAIL_MODE === "cloud") {
    if (!env.EMAIL_DELIVERY_QUEUE) throw new HouseholdInvitationError("email_not_configured", "Email delivery is not configured.");
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

export async function revokeHouseholdInvitation(db: D1Database, householdId: string, userId: string, invitationId: string) {
  await requireHouseholdOwner(db, householdId, userId);
  const result = await db.prepare(`UPDATE household_invitations SET status='revoked', revoked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND household_id=? AND status='pending'`).bind(invitationId, householdId).run();
  if (!result.meta.changes) throw new HouseholdInvitationError("invitation_not_found", "Invitation is no longer pending.");
}

export async function resolveHouseholdInvitation(db: D1Database, token: string): Promise<HouseholdInvitationView | null> {
  if (!token || token.length > 256) return null;
  const row = await db.prepare(`SELECT hi.id, hi.household_id, h.name household_name, hi.invited_email, hi.relationship, hi.role,
      u.name inviter_name, hi.expires_at, hi.created_at, hi.delivery_status,
      EXISTS(SELECT 1 FROM "user" existing WHERE lower(existing.email)=hi.invited_email) existing_account
    FROM household_invitations hi JOIN households h ON h.id=hi.household_id JOIN "user" u ON u.id=hi.invited_by_user_id
    WHERE hi.token_hash=? AND hi.status='pending' AND datetime(hi.expires_at)>CURRENT_TIMESTAMP`)
    .bind(await hashInvitationToken(token)).first<InvitationRow>();
  return row ? mapInvitation(row) : null;
}

export async function acceptHouseholdInvitation(db: D1Database, invitation: HouseholdInvitationView, user: { id: string; email: string }) {
  if (user.email.trim().toLowerCase() !== invitation.email) {
    throw new HouseholdInvitationError("email_mismatch", `Sign in as ${invitation.email} to join this household.`);
  }
  const accepted = await db.prepare(`UPDATE household_invitations SET status='accepted', accepted_by_user_id=?, accepted_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending' AND datetime(expires_at)>CURRENT_TIMESTAMP`)
    .bind(user.id, invitation.id).run();
  if (!accepted.meta.changes) throw new HouseholdInvitationError("invitation_unavailable", "This invitation has expired or was already used.");
  try {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO household_members (household_id, user_id, role, relationship) VALUES (?, ?, ?, ?)`)
        .bind(invitation.householdId, user.id, invitation.role, invitation.relationship),
      db.prepare(`INSERT INTO user_profiles (user_id, default_household_id) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET default_household_id=excluded.default_household_id, updated_at=CURRENT_TIMESTAMP`)
        .bind(user.id, invitation.householdId),
      db.prepare("INSERT OR IGNORE INTO household_preferences (household_id) VALUES (?)").bind(invitation.householdId),
      db.prepare(`UPDATE "user" SET emailVerified=1, updatedAt=? WHERE id=?`).bind(Date.now(), user.id),
    ]);
  } catch (error) {
    await db.prepare(`UPDATE household_invitations SET status='pending', accepted_by_user_id=NULL, accepted_at=NULL,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND accepted_by_user_id=?`).bind(invitation.id, user.id).run();
    throw error;
  }
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

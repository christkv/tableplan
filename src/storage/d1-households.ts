import { HouseholdInvitationError, INVITATION_LIFETIME_DAYS, hashInvitationToken, randomInvitationToken, type HouseholdInvitationEmailRecord, type HouseholdInvitationView, type HouseholdInviteRole, type HouseholdOverview, type HouseholdRelationship } from "../domain/households";

async function requireOwner(db: D1Database, householdId: string, userId: string) {
  const row = await db.prepare("SELECT role FROM household_members WHERE household_id=? AND user_id=?").bind(householdId, userId).first<{ role: string }>();
  if (row?.role !== "owner") throw new HouseholdInvitationError("owner_required", "Only the household owner can manage invitations.");
}

export async function d1HouseholdOverview(db: D1Database, householdId: string, userId: string): Promise<HouseholdOverview> {
  const current = await db.prepare("SELECT role FROM household_members WHERE household_id=? AND user_id=?").bind(householdId, userId).first<{ role: HouseholdOverview["currentRole"] }>();
  if (!current) throw new HouseholdInvitationError("not_a_member", "Household membership was not found.");
  const [household, members, invitations, available] = await Promise.all([
    db.prepare("SELECT id, name FROM households WHERE id=?").bind(householdId).first<{ id: string; name: string }>(),
    db.prepare(`SELECT hm.user_id, hm.role, hm.relationship, hm.created_at, u.name, u.email FROM household_members hm JOIN "user" u ON u.id=hm.user_id WHERE hm.household_id=? ORDER BY CASE hm.role WHEN 'owner' THEN 0 WHEN 'adult' THEN 1 ELSE 2 END, lower(u.name)`).bind(householdId).all<{ user_id: string; role: HouseholdOverview["currentRole"]; relationship: HouseholdRelationship; created_at: string; name: string; email: string }>(),
    current.role === "owner" ? db.prepare("SELECT id, invited_email, relationship, role, expires_at, delivery_status, created_at FROM household_invitations WHERE household_id=? AND status='pending' ORDER BY created_at DESC").bind(householdId).all<{ id: string; invited_email: string; relationship: HouseholdRelationship; role: HouseholdInviteRole; expires_at: string; delivery_status: string; created_at: string }>() : Promise.resolve({ results: [] }),
    db.prepare("SELECT h.id, h.name, hm.role FROM household_members hm JOIN households h ON h.id=hm.household_id WHERE hm.user_id=? ORDER BY lower(h.name)").bind(userId).all<{ id: string; name: string; role: HouseholdOverview["currentRole"] }>(),
  ]);
  if (!household) throw new HouseholdInvitationError("household_not_found", "Household was not found.");
  return { household, currentRole: current.role, availableHouseholds: available.results, members: members.results.map((m) => ({ userId: m.user_id, name: m.name, email: m.email, role: m.role, relationship: m.relationship, joinedAt: m.created_at })), invitations: invitations.results.map((i) => ({ id: i.id, email: i.invited_email, relationship: i.relationship, role: i.role, expiresAt: i.expires_at, deliveryStatus: i.delivery_status, createdAt: i.created_at, expired: Date.parse(i.expires_at) <= Date.now() })) };
}
export async function d1SwitchHousehold(db: D1Database, userId: string, householdId: string) {
  if (!await db.prepare("SELECT 1 ok FROM household_members WHERE household_id=? AND user_id=?").bind(householdId, userId).first()) throw new HouseholdInvitationError("not_a_member", "You do not belong to that household.");
  await db.prepare("INSERT INTO user_profiles (user_id, default_household_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET default_household_id=excluded.default_household_id, updated_at=CURRENT_TIMESTAMP").bind(userId, householdId).run();
}
export async function d1CreateInvitation(db: D1Database, input: { householdId: string; invitedByUserId: string; email: string; relationship: HouseholdRelationship; role: HouseholdInviteRole }) {
  await requireOwner(db, input.householdId, input.invitedByUserId);
  if (await db.prepare(`SELECT 1 ok FROM household_members hm JOIN "user" u ON u.id=hm.user_id WHERE hm.household_id=? AND lower(u.email)=?`).bind(input.householdId, input.email).first()) throw new HouseholdInvitationError("already_a_member", "That email already belongs to this household.");
  const [byUser, byHousehold] = await Promise.all([db.prepare("SELECT COUNT(*) count FROM household_invitations WHERE invited_by_user_id=? AND created_at>=datetime('now','-1 hour')").bind(input.invitedByUserId).first<{ count: number }>(), db.prepare("SELECT COUNT(*) count FROM household_invitations WHERE household_id=? AND created_at>=datetime('now','-1 day')").bind(input.householdId).first<{ count: number }>()]);
  if ((byUser?.count ?? 0) >= 10 || (byHousehold?.count ?? 0) >= 30) throw new HouseholdInvitationError("rate_limited", "Invitation limit reached. Try again later.");
  await db.prepare("UPDATE household_invitations SET status='revoked', revoked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE household_id=? AND invited_email=? AND status='pending'").bind(input.householdId, input.email).run();
  const id = crypto.randomUUID(); const token = randomInvitationToken(); const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_DAYS * 86_400_000).toISOString();
  await db.prepare("INSERT INTO household_invitations (id, household_id, invited_email, relationship, role, token_prefix, token_hash, invited_by_user_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, input.householdId, input.email, input.relationship, input.role, token.slice(0, 10), await hashInvitationToken(token), input.invitedByUserId, expiresAt).run();
  return { id, email: input.email, expiresAt, token };
}
export async function d1RevokeInvitation(db: D1Database, householdId: string, userId: string, invitationId: string) { await requireOwner(db, householdId, userId); const result = await db.prepare("UPDATE household_invitations SET status='revoked', revoked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND household_id=? AND status='pending'").bind(invitationId, householdId).run(); if (!result.meta.changes) throw new HouseholdInvitationError("invitation_not_found", "Invitation is no longer pending."); }
export async function d1ResolveInvitation(db: D1Database, token: string): Promise<HouseholdInvitationView | null> {
  if (!token || token.length > 256) return null;
  const r = await db.prepare(`SELECT hi.id, hi.household_id, h.name household_name, hi.invited_email, hi.relationship, hi.role, u.name inviter_name, hi.expires_at, hi.created_at, hi.delivery_status, EXISTS(SELECT 1 FROM "user" existing WHERE lower(existing.email)=hi.invited_email) existing_account FROM household_invitations hi JOIN households h ON h.id=hi.household_id JOIN "user" u ON u.id=hi.invited_by_user_id WHERE hi.token_hash=? AND hi.status='pending' AND datetime(hi.expires_at)>CURRENT_TIMESTAMP`).bind(await hashInvitationToken(token)).first<{ id: string; household_id: string; household_name: string; invited_email: string; relationship: HouseholdRelationship; role: HouseholdInviteRole; inviter_name: string; expires_at: string; created_at: string; delivery_status: string; existing_account: number }>();
  return r ? { id: r.id, householdId: r.household_id, householdName: r.household_name, email: r.invited_email, relationship: r.relationship, role: r.role, inviterName: r.inviter_name, expiresAt: r.expires_at, createdAt: r.created_at, deliveryStatus: r.delivery_status, existingAccount: Boolean(r.existing_account) } : null;
}
export async function d1AcceptInvitation(db: D1Database, invitation: HouseholdInvitationView, user: { id: string; email: string }) {
  if (user.email.trim().toLowerCase() !== invitation.email) throw new HouseholdInvitationError("email_mismatch", `Sign in as ${invitation.email} to join this household.`);
  const accepted = await db.prepare("UPDATE household_invitations SET status='accepted', accepted_by_user_id=?, accepted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending' AND datetime(expires_at)>CURRENT_TIMESTAMP").bind(user.id, invitation.id).run();
  if (!accepted.meta.changes) throw new HouseholdInvitationError("invitation_unavailable", "This invitation has expired or was already used.");
  try {
    await db.batch([db.prepare("INSERT OR IGNORE INTO household_members (household_id, user_id, role, relationship) VALUES (?, ?, ?, ?)").bind(invitation.householdId, user.id, invitation.role, invitation.relationship), db.prepare("INSERT INTO user_profiles (user_id, default_household_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET default_household_id=excluded.default_household_id, updated_at=CURRENT_TIMESTAMP").bind(user.id, invitation.householdId), db.prepare("INSERT OR IGNORE INTO household_preferences (household_id) VALUES (?)").bind(invitation.householdId), db.prepare(`UPDATE "user" SET emailVerified=1, updatedAt=? WHERE id=?`).bind(Date.now(), user.id)]);
  } catch (error) {
    await db.prepare(`UPDATE household_invitations SET status='pending', accepted_by_user_id=NULL,
      accepted_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND accepted_by_user_id=?`)
      .bind(invitation.id, user.id).run();
    throw error;
  }
}
export async function d1ClaimInvitationEmail(db: D1Database, id: string): Promise<HouseholdInvitationEmailRecord | null> {
  const claimed = await db.prepare(`UPDATE household_invitations SET delivery_status='sending',
    delivery_attempt_count=delivery_attempt_count+1, delivery_error=NULL, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='pending' AND delivery_status IN ('pending','queued','failed')`).bind(id).run();
  if (!claimed.meta.changes) return null;
  const r = await db.prepare(`SELECT hi.id, hi.invited_email, hi.relationship, hi.expires_at,
    hi.delivery_status, h.name household_name, u.name inviter_name FROM household_invitations hi
    JOIN households h ON h.id=hi.household_id JOIN "user" u ON u.id=hi.invited_by_user_id WHERE hi.id=?`)
    .bind(id).first<{ id: string; invited_email: string; relationship: string; expires_at: string; delivery_status: string; household_name: string; inviter_name: string }>();
  if (!r) {
    await d1InvitationDelivery(db, id, "failed", { error: "Invitation email dependencies were not found" });
    throw new Error("Invitation email dependencies were not found");
  }
  return { id: r.id, email: r.invited_email, relationship: r.relationship, expiresAt: r.expires_at, deliveryStatus: r.delivery_status, householdName: r.household_name, inviterName: r.inviter_name };
}
export async function d1InvitationDelivery(db: D1Database, id: string, status: "queued" | "sending" | "sent" | "failed", details?: { providerMessageId?: string; error?: string }) {
  const allowedCurrent = status === "queued" ? ["pending"] : status === "failed" ? ["pending", "sending"] : status === "sent" ? ["sending"] : [];
  if (!allowedCurrent.length) return;
  await db.prepare(`UPDATE household_invitations SET delivery_status=?,
    queued_at=CASE WHEN ?='queued' THEN CURRENT_TIMESTAMP ELSE queued_at END,
    sent_at=CASE WHEN ?='sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,
    provider_message_id=COALESCE(?,provider_message_id), delivery_error=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND delivery_status IN (?,?)`).bind(status, status, status, details?.providerMessageId ?? null, details?.error ?? null, id, allowedCurrent[0], allowedCurrent[1] ?? allowedCurrent[0]).run();
}

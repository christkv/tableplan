import type { ClientSession, Db, Document } from "mongodb";

import { HouseholdInvitationError, INVITATION_LIFETIME_DAYS, hashInvitationToken, randomInvitationToken, type HouseholdInvitationEmailRecord, type HouseholdInvitationView, type HouseholdInviteRole, type HouseholdOverview, type HouseholdRelationship } from "../src/domain/households";

type StringDocument = Document & { _id: string };
type TransactionRunner = <T>(operation: (session: ClientSession) => Promise<T>) => Promise<T>;
const iso = (value: unknown) => new Date(value as string | Date).toISOString();

export interface MongoHouseholdStore {
  overview(householdId: string, userId: string): Promise<HouseholdOverview>;
  switchDefault(userId: string, householdId: string): Promise<void>;
  createInvitation(input: { householdId: string; invitedByUserId: string; email: string; relationship: HouseholdRelationship; role: HouseholdInviteRole }): Promise<{ id: string; email: string; expiresAt: string; token: string }>;
  revokeInvitation(householdId: string, userId: string, invitationId: string): Promise<void>;
  resolveInvitation(token: string): Promise<HouseholdInvitationView | null>;
  acceptInvitation(invitation: HouseholdInvitationView, user: { id: string; email: string }): Promise<void>;
  claimInvitationEmail(invitationId: string): Promise<HouseholdInvitationEmailRecord | null>;
  updateInvitationDelivery(invitationId: string, status: "queued" | "sending" | "sent" | "failed", details?: { providerMessageId?: string; error?: string }): Promise<void>;
}

export function createMongoHouseholdStore(database: Db, withTransaction: TransactionRunner): MongoHouseholdStore {
  const households = database.collection<StringDocument>("households"); const memberships = database.collection<StringDocument>("household_memberships");
  const invitations = database.collection<StringDocument>("household_invitations"); const users = database.collection<StringDocument>("users"); const profiles = database.collection<StringDocument>("user_profiles");
  const requireOwner = async (householdId: string, userId: string) => { if ((await memberships.findOne({ householdId, userId }))?.role !== "owner") throw new HouseholdInvitationError("owner_required", "Only the household owner can manage invitations."); };
  return {
    async overview(householdId, userId) {
      const current = await memberships.findOne({ householdId, userId }); if (!current) throw new HouseholdInvitationError("not_a_member", "Household membership was not found.");
      const household = await households.findOne({ _id: householdId }); if (!household) throw new HouseholdInvitationError("household_not_found", "Household was not found.");
      const memberDocs = await memberships.find({ householdId }).sort({ roleOrder: 1, createdAt: 1 }).toArray(); const memberUsers = await users.find({ _id: { $in: memberDocs.map((m) => String(m.userId)) } }).toArray(); const byId = new Map(memberUsers.map((u) => [u._id, u]));
      const availableDocs = await memberships.find({ userId }).toArray(); const availableHouseholdDocs = await households.find({ _id: { $in: availableDocs.map((m) => String(m.householdId)) } }).toArray(); const availableById = new Map(availableHouseholdDocs.map((h) => [h._id, h]));
      const pending = current.role === "owner" ? await invitations.find({ householdId, status: "pending" }).sort({ createdAt: -1 }).toArray() : [];
      return { household: { id: household._id, name: String(household.name) }, currentRole: current.role as HouseholdOverview["currentRole"], availableHouseholds: availableDocs.map((m) => ({ id: String(m.householdId), name: String(availableById.get(String(m.householdId))?.name ?? "Household"), role: m.role as HouseholdOverview["currentRole"] })), members: memberDocs.map((m) => { const user = byId.get(String(m.userId)); return { userId: String(m.userId), name: String(user?.name ?? "Member"), email: String(user?.email ?? ""), role: m.role as HouseholdOverview["currentRole"], relationship: (m.relationship ?? "other") as HouseholdRelationship, joinedAt: iso(m.createdAt) }; }), invitations: pending.map((i) => ({ id: i._id, email: String(i.email), relationship: i.relationship as HouseholdRelationship, role: i.role as HouseholdInviteRole, expiresAt: iso(i.expiresAt), deliveryStatus: String(i.deliveryStatus), createdAt: iso(i.createdAt), expired: new Date(i.expiresAt as Date) <= new Date() })) };
    },
    async switchDefault(userId, householdId) { if (!await memberships.findOne({ userId, householdId })) throw new HouseholdInvitationError("not_a_member", "You do not belong to that household."); await profiles.updateOne({ _id: userId }, { $set: { defaultHouseholdId: householdId, updatedAt: new Date() } }, { upsert: true }); },
    async createInvitation(input) {
      await requireOwner(input.householdId, input.invitedByUserId); const existing = await users.findOne({ email: input.email }); if (existing && await memberships.findOne({ householdId: input.householdId, userId: existing._id })) throw new HouseholdInvitationError("already_a_member", "That email already belongs to this household.");
      const now = new Date(); const [byUser, byHousehold] = await Promise.all([invitations.countDocuments({ invitedByUserId: input.invitedByUserId, createdAt: { $gte: new Date(now.getTime() - 3_600_000) } }), invitations.countDocuments({ householdId: input.householdId, createdAt: { $gte: new Date(now.getTime() - 86_400_000) } })]); if (byUser >= 10 || byHousehold >= 30) throw new HouseholdInvitationError("rate_limited", "Invitation limit reached. Try again later.");
      await invitations.updateMany({ householdId: input.householdId, email: input.email, status: "pending" }, { $set: { status: "revoked", revokedAt: now, updatedAt: now } }); const id = crypto.randomUUID(); const token = randomInvitationToken(); const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_DAYS * 86_400_000);
      await invitations.insertOne({ _id: id, householdId: input.householdId, email: input.email, normalizedEmail: input.email, relationship: input.relationship, role: input.role, tokenPrefix: token.slice(0, 10), tokenHash: await hashInvitationToken(token), invitedByUserId: input.invitedByUserId, status: "pending", expiresAt, deliveryStatus: "pending", deliveryAttemptCount: 0, createdAt: now, updatedAt: now }); return { id, email: input.email, expiresAt: expiresAt.toISOString(), token };
    },
    async revokeInvitation(householdId, userId, invitationId) { await requireOwner(householdId, userId); const result = await invitations.updateOne({ _id: invitationId, householdId, status: "pending" }, { $set: { status: "revoked", revokedAt: new Date(), updatedAt: new Date() } }); if (!result.matchedCount) throw new HouseholdInvitationError("invitation_not_found", "Invitation is no longer pending."); },
    async resolveInvitation(token) { if (!token || token.length > 256) return null; const invitation = await invitations.findOne({ tokenHash: await hashInvitationToken(token), status: "pending", expiresAt: { $gt: new Date() } }); if (!invitation) return null; const [household, inviter, existing] = await Promise.all([households.findOne({ _id: String(invitation.householdId) }), users.findOne({ _id: String(invitation.invitedByUserId) }), users.findOne({ email: invitation.email })]); if (!household || !inviter) return null; return { id: invitation._id, householdId: String(invitation.householdId), householdName: String(household.name), email: String(invitation.email), relationship: invitation.relationship as HouseholdRelationship, role: invitation.role as HouseholdInviteRole, inviterName: String(inviter.name), expiresAt: iso(invitation.expiresAt), createdAt: iso(invitation.createdAt), deliveryStatus: String(invitation.deliveryStatus), existingAccount: Boolean(existing) }; },
    async acceptInvitation(invitation, user) { if (user.email.trim().toLowerCase() !== invitation.email) throw new HouseholdInvitationError("email_mismatch", `Sign in as ${invitation.email} to join this household.`); await withTransaction(async (session) => { const now = new Date(); const accepted = await invitations.updateOne({ _id: invitation.id, status: "pending", expiresAt: { $gt: now } }, { $set: { status: "accepted", acceptedByUserId: user.id, acceptedAt: now, updatedAt: now } }, { session }); if (!accepted.matchedCount) throw new HouseholdInvitationError("invitation_unavailable", "This invitation has expired or was already used."); await memberships.updateOne({ householdId: invitation.householdId, userId: user.id }, { $setOnInsert: { _id: crypto.randomUUID(), role: invitation.role, roleOrder: 1, relationship: invitation.relationship, createdAt: now } }, { upsert: true, session }); await profiles.updateOne({ _id: user.id }, { $set: { defaultHouseholdId: invitation.householdId, updatedAt: now } }, { upsert: true, session }); await users.updateOne({ _id: user.id }, { $set: { emailVerified: true, updatedAt: now } }, { session }); }); },
    async claimInvitationEmail(invitationId) {
      const i = await invitations.findOneAndUpdate(
        { _id: invitationId, status: "pending", deliveryStatus: { $in: ["pending", "queued", "failed"] } },
        { $set: { deliveryStatus: "sending", deliveryError: null, updatedAt: new Date() }, $inc: { deliveryAttemptCount: 1 } },
        { returnDocument: "after" },
      );
      if (!i) return null;
      const [h, u] = await Promise.all([households.findOne({ _id: String(i.householdId) }), users.findOne({ _id: String(i.invitedByUserId) })]);
      if (!h || !u) {
        await invitations.updateOne({ _id: invitationId, deliveryStatus: "sending" }, { $set: { deliveryStatus: "failed", deliveryError: "Invitation email dependencies were not found", updatedAt: new Date() } });
        throw new Error("Invitation email dependencies were not found");
      }
      return { id: i._id, email: String(i.email), relationship: String(i.relationship), expiresAt: iso(i.expiresAt), deliveryStatus: String(i.deliveryStatus), householdName: String(h.name), inviterName: String(u.name) };
    },
    async updateInvitationDelivery(invitationId, status, details) {
      const now = new Date(); const set: Document = { deliveryStatus: status, deliveryError: details?.error ?? null, updatedAt: now };
      if (status === "queued") set.queuedAt = now;
      if (status === "sent") { set.sentAt = now; set.providerMessageId = details?.providerMessageId ?? null; }
      const allowedCurrent = status === "queued" ? ["pending"] : status === "failed" ? ["pending", "sending"] : status === "sent" ? ["sending"] : [];
      if (allowedCurrent.length) await invitations.updateOne({ _id: invitationId, deliveryStatus: { $in: allowedCurrent } }, { $set: set });
    },
  };
}

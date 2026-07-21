const encoder = new TextEncoder();
export const INVITATION_LIFETIME_DAYS = 7;
export const householdRelationships = ["spouse", "child", "flatmate", "other"] as const;
export type HouseholdRelationship = typeof householdRelationships[number];
export const householdInviteRoles = ["adult"] as const;
export type HouseholdInviteRole = typeof householdInviteRoles[number];

export class HouseholdInvitationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "HouseholdInvitationError"; }
}
export function normalizeInvitationEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HouseholdInvitationError("invalid_email", "Enter a valid email address.");
  return email;
}
export function parseHouseholdRelationship(value: unknown): HouseholdRelationship {
  const relationship = String(value ?? "other") as HouseholdRelationship;
  if (!householdRelationships.includes(relationship)) throw new HouseholdInvitationError("invalid_relationship", "Choose a valid household relationship.");
  return relationship;
}
export function parseHouseholdInviteRole(value: unknown): HouseholdInviteRole {
  const role = String(value ?? "adult") as HouseholdInviteRole;
  if (!householdInviteRoles.includes(role)) throw new HouseholdInvitationError("invalid_role", "Invited accounts must be household members.");
  return role;
}
export function randomInvitationToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes)); let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export interface HouseholdInvitationView { id: string; householdId: string; householdName: string; email: string; relationship: HouseholdRelationship; role: HouseholdInviteRole; inviterName: string; expiresAt: string; createdAt: string; deliveryStatus: string; existingAccount: boolean }
export interface HouseholdOverview {
  household: { id: string; name: string }; currentRole: "owner" | "adult" | "viewer";
  availableHouseholds: Array<{ id: string; name: string; role: "owner" | "adult" | "viewer" }>;
  members: Array<{ userId: string; name: string; email: string; role: "owner" | "adult" | "viewer"; relationship: HouseholdRelationship; joinedAt: string }>;
  invitations: Array<{ id: string; email: string; relationship: HouseholdRelationship; role: HouseholdInviteRole; expiresAt: string; deliveryStatus: string; createdAt: string; expired: boolean }>;
}
export interface HouseholdInvitationEmailRecord { id: string; email: string; relationship: string; expiresAt: string; deliveryStatus: string; householdName: string; inviterName: string }

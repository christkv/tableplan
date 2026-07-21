import { createHash, randomBytes } from "node:crypto";
import type { Db, Document } from "mongodb";

import type { RecipeAccessContext } from "../src/domain/recipes";
import { parseShareExpiryDays, type ResolvedShoppingShare, type ShoppingShareView } from "../src/domain/shopping-share";
import type { MongoShoppingStore } from "./shopping";

interface ShareDocument extends Document { _id: string; listId: string; householdId: string; tokenPrefix: string; tokenHash: string; createdByUserId: string; expiresAt: Date | string; revokedAt?: Date | string | null; lastAccessedAt?: Date | string | null; createdAt: Date | string }
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const iso = (value: Date | string | null | undefined) => value ? (value instanceof Date ? value : new Date(value)).toISOString() : null;

export interface MongoShareStore {
  create(input: { householdId: string; userId: string; listId: string; expiresInDays: number }): Promise<{ id: string; token: string; expiresAt: string }>;
  resolve(token: string, expectedShareId?: string): Promise<ResolvedShoppingShare | null>;
  revoke(access: RecipeAccessContext, listId: string, shareId: string): Promise<boolean>;
  list(access: RecipeAccessContext, listId: string): Promise<ShoppingShareView[]>;
  getPublicList(share: ResolvedShoppingShare): ReturnType<MongoShoppingStore["getPublic"]>;
  togglePublic(share: ResolvedShoppingShare, itemId: string, checked: boolean): Promise<boolean>;
  touch(shareId: string): Promise<void>;
}

export function createMongoShareStore(database: Db, shopping: MongoShoppingStore): MongoShareStore {
  const shares = database.collection<ShareDocument>("shopping_list_shares");
  const memberships = database.collection("household_memberships");
  const requireMember = async (access: RecipeAccessContext) => { if (!await memberships.findOne({ userId: access.userId, householdId: access.householdId }, { projection: { _id: 1 } })) throw new Error("household_access_denied"); };
  return {
    async create(input) {
      const access = { userId: input.userId, householdId: input.householdId }; await requireMember(access);
      if (!await shopping.getById(access, input.listId)) throw new Error("shopping_list_not_found");
      const id = crypto.randomUUID(); const token = randomBytes(32).toString("base64url"); const expiresAt = new Date(Date.now() + parseShareExpiryDays(input.expiresInDays) * 86_400_000);
      await shares.insertOne({ _id: id, listId: input.listId, householdId: input.householdId, tokenPrefix: token.slice(0, 10), tokenHash: hash(token), createdByUserId: input.userId, expiresAt, revokedAt: null, lastAccessedAt: null, createdAt: new Date() });
      return { id, token, expiresAt: expiresAt.toISOString() };
    },
    async resolve(token, expectedShareId) {
      if (!token || token.length > 256) return null;
      const document = await shares.findOne({ tokenHash: hash(token), revokedAt: null, expiresAt: { $gt: new Date() }, ...(expectedShareId ? { _id: expectedShareId } : {}) });
      return document ? { id: document._id, listId: document.listId, householdId: document.householdId, expiresAt: iso(document.expiresAt)! } : null;
    },
    async revoke(access, listId, shareId) { await requireMember(access); const result = await shares.updateOne({ _id: shareId, householdId: access.householdId, listId, revokedAt: null }, { $set: { revokedAt: new Date() } }); return Boolean(result.modifiedCount); },
    async list(access, listId) { await requireMember(access); return (await shares.find({ householdId: access.householdId, listId }).sort({ createdAt: -1 }).limit(10).toArray()).map((item) => ({ id: item._id, tokenPrefix: item.tokenPrefix, expiresAt: iso(item.expiresAt)!, revokedAt: iso(item.revokedAt), lastAccessedAt: iso(item.lastAccessedAt), createdAt: iso(item.createdAt)! })); },
    getPublicList(share) { return shopping.getPublic(share.householdId, share.listId); },
    togglePublic(share, itemId, checked) { return shopping.togglePublic(share.householdId, share.listId, itemId, checked); },
    async touch(shareId) { await shares.updateOne({ _id: shareId, revokedAt: null }, { $set: { lastAccessedAt: new Date() } }); },
  };
}

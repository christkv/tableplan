import type { Db, Document } from "mongodb";

type StringDocument = Document & { _id: string };
const iso = (value: unknown): string | null => value ? new Date(value as string | Date).toISOString() : null;

export interface MongoEmailStore {
  create(input: { householdId: string; userId: string; listId: string; shareId: string; recipientEmail: string }): Promise<string>;
  claim(deliveryId: string): Promise<{ id: string; userId: string; householdId: string; shoppingListId: string; recipientEmail: string; status: string; expiresAt: string } | null>;
  update(deliveryId: string, status: "queued" | "sending" | "sent" | "failed", details?: { providerMessageId?: string; error?: string }): Promise<void>;
  get(householdId: string, userId: string, deliveryId: string): Promise<{ id: string; shoppingListId: string; shareId: string; recipientEmail: string; status: string; attemptCount: number; lastError: string | null; queuedAt: string | null; sentAt: string | null; createdAt: string } | null>;
}
export function createMongoEmailStore(database: Db): MongoEmailStore {
  const deliveries = database.collection<StringDocument>("email_deliveries"); const lists = database.collection<StringDocument>("shopping_lists"); const shares = database.collection<StringDocument>("shopping_list_shares");
  return {
    async create(input) { const now = new Date(); const [byUser, byHousehold] = await Promise.all([deliveries.countDocuments({ userId: input.userId, createdAt: { $gte: new Date(now.getTime() - 3_600_000) } }), deliveries.countDocuments({ householdId: input.householdId, createdAt: { $gte: new Date(now.getTime() - 86_400_000) } })]); if (byUser >= 5 || byHousehold >= 20) throw new Error("Email rate limit reached. Try again later."); if (!await lists.findOne({ _id: input.listId, householdId: input.householdId })) throw new Error("Shopping list not found"); const id = crypto.randomUUID(); await deliveries.insertOne({ _id: id, ...input, shoppingListId: input.listId, status: "pending", attemptCount: 0, createdAt: now, updatedAt: now }); return id; },
    async claim(deliveryId) {
      const d = await deliveries.findOneAndUpdate(
        { _id: deliveryId, status: { $in: ["pending", "queued", "failed"] } },
        { $set: { status: "sending", lastErrorCode: null, lastErrorMessage: null, updatedAt: new Date() }, $inc: { attemptCount: 1 } },
        { returnDocument: "after" },
      );
      if (!d) return null;
      const share = await shares.findOne({ _id: String(d.shareId) });
      if (!share) {
        await deliveries.updateOne({ _id: deliveryId, status: "sending" }, { $set: { status: "failed", lastErrorCode: "delivery_failed", lastErrorMessage: "Email delivery dependencies were not found", updatedAt: new Date() } });
        throw new Error("Email delivery dependencies were not found");
      }
      return { id: d._id, userId: String(d.userId), householdId: String(d.householdId), shoppingListId: String(d.shoppingListId), recipientEmail: String(d.recipientEmail), status: String(d.status), expiresAt: iso(share.expiresAt)! };
    },
    async update(deliveryId, status, details) {
      const now = new Date();
      const set: Document = { status, lastErrorCode: status === "failed" ? "delivery_failed" : null, lastErrorMessage: details?.error ?? null, updatedAt: now };
      if (status === "queued") set.queuedAt = now;
      if (status === "sent") { set.sentAt = now; set.providerMessageId = details?.providerMessageId ?? null; }
      const allowedCurrent = status === "queued" ? ["pending"] : status === "failed" ? ["pending", "sending"] : status === "sent" ? ["sending"] : [];
      if (allowedCurrent.length) await deliveries.updateOne({ _id: deliveryId, status: { $in: allowedCurrent } }, { $set: set });
    },
    async get(householdId, userId, deliveryId) { const d = await deliveries.findOne({ _id: deliveryId, householdId, userId }); return d ? { id: d._id, shoppingListId: String(d.shoppingListId), shareId: String(d.shareId), recipientEmail: String(d.recipientEmail), status: String(d.status), attemptCount: Number(d.attemptCount ?? 0), lastError: d.lastErrorMessage ? String(d.lastErrorMessage) : null, queuedAt: iso(d.queuedAt), sentAt: iso(d.sentAt), createdAt: iso(d.createdAt)! } : null; },
  };
}

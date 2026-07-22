import type { Db, Document } from "mongodb";

import { API_SCOPES, apiKeyPrefix, hashApiKey, randomApiToken, type ApiKeyAuthentication, type ApiKeyView, type ApiScope } from "../../domain/api-keys";

type StringDocument = Document & { _id: string };

export interface MongoApiKeyStore {
  create(input: { userId: string; householdId: string; name: string; environment: "test" | "live"; scopes: ApiScope[]; expiresAt?: string }): Promise<{ id: string; key: string }>;
  list(userId: string): Promise<ApiKeyView[]>;
  revoke(userId: string, keyId: string): Promise<void>;
  authenticate(key: string): Promise<ApiKeyAuthentication | null>;
}

function toIso(value: unknown): string | null {
  return value ? new Date(value as string | Date).toISOString() : null;
}

function safeScopes(value: unknown): ApiScope[] {
  return Array.isArray(value) ? value.filter((scope): scope is ApiScope => API_SCOPES.includes(scope as ApiScope)) : [];
}

export function createMongoApiKeyStore(database: Db): MongoApiKeyStore {
  const keys = database.collection<StringDocument>("api_keys");
  const memberships = database.collection<StringDocument>("household_memberships");
  const requireMember = async (userId: string, householdId: string) => {
    if (!await memberships.findOne({ userId, householdId }, { projection: { _id: 1 } })) throw new Error("household_access_denied");
  };

  return {
    async create(input) {
      await requireMember(input.userId, input.householdId);
      const name = input.name.trim();
      if (!name) throw new Error("api_key_name_required");
      const scopes = [...new Set(input.scopes)].filter((scope) => API_SCOPES.includes(scope));
      if (!scopes.length) throw new Error("api_key_scopes_required");
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) throw new Error("api_key_expiry_invalid");
      const id = crypto.randomUUID();
      const key = `mp_${input.environment}_${randomApiToken()}`;
      await keys.insertOne({
        _id: id, userId: input.userId, householdId: input.householdId, name, prefix: apiKeyPrefix(key),
        keyHash: await hashApiKey(key), scopes, expiresAt, revokedAt: null, lastUsedAt: null, createdAt: new Date(),
      });
      return { id, key };
    },
    async list(userId) {
      const documents = await keys.find({ userId }).sort({ createdAt: -1 }).limit(200).toArray();
      return documents.map((document) => ({
        id: document._id, name: String(document.name), prefix: String(document.prefix), scopes: safeScopes(document.scopes),
        expiresAt: toIso(document.expiresAt), lastUsedAt: toIso(document.lastUsedAt), revokedAt: toIso(document.revokedAt),
        createdAt: toIso(document.createdAt) ?? new Date(0).toISOString(),
      }));
    },
    async revoke(userId, keyId) {
      await keys.updateOne({ _id: keyId, userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    },
    async authenticate(key) {
      const document = await keys.findOne({ prefix: apiKeyPrefix(key), keyHash: await hashApiKey(key), revokedAt: null });
      if (!document) return null;
      if (document.expiresAt && new Date(document.expiresAt as string | Date) <= new Date()) return null;
      if (!await memberships.findOne({ userId: document.userId, householdId: document.householdId }, { projection: { _id: 1 } })) return null;
      await keys.updateOne({ _id: document._id }, { $set: { lastUsedAt: new Date() } });
      return { id: document._id, userId: String(document.userId), householdId: String(document.householdId), scopes: safeScopes(document.scopes) };
    },
  };
}

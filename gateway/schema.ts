import type { Db, Document, IndexDescription } from "mongodb";

export interface CollectionDefinition {
  name: string;
  indexes: IndexDescription[];
  validator?: Document;
}

const objectValidator = (required: string[], properties: Document): Document => ({
  $jsonSchema: { bsonType: "object", required: ["_id", ...required], properties: { _id: { bsonType: "string" }, ...properties } },
});

export const collectionDefinitions: CollectionDefinition[] = [
  { name: "users", indexes: [{ key: { email: 1 }, name: "user_email_unique", unique: true }] },
  { name: "sessions", indexes: [{ key: { token: 1 }, name: "session_token_unique", unique: true }, { key: { expiresAt: 1 }, name: "session_expiry" }, { key: { userId: 1 }, name: "session_user" }] },
  { name: "accounts", indexes: [{ key: { providerId: 1, accountId: 1 }, name: "account_provider_unique", unique: true }, { key: { userId: 1 }, name: "account_user" }] },
  { name: "verifications", indexes: [{ key: { identifier: 1, value: 1 }, name: "verification_lookup" }, { key: { expiresAt: 1 }, name: "verification_expiry" }] },
  { name: "households", indexes: [], validator: objectValidator(["name"], { name: { bsonType: "string" }, timezone: { bsonType: ["string", "null"] } }) },
  { name: "household_memberships", indexes: [{ key: { householdId: 1, userId: 1 }, name: "membership_unique", unique: true }, { key: { userId: 1, createdAt: 1 }, name: "membership_user" }], validator: objectValidator(["householdId", "userId", "role"], { householdId: { bsonType: "string" }, userId: { bsonType: "string" }, role: { enum: ["owner", "adult", "viewer"] }, relationship: { bsonType: ["string", "null"] } }) },
  { name: "user_profiles", indexes: [{ key: { userId: 1 }, name: "profile_user_unique", unique: true, sparse: true }] },
  { name: "recipes", indexes: [{ key: { sourceId: 1 }, name: "recipe_source", unique: true, sparse: true }, { key: { visibility: 1, status: 1, name: 1 }, name: "recipe_catalog_list" }, { key: { visibility: 1, status: 1, tags: 1, name: 1 }, name: "recipe_catalog_tags_list" }, { key: { ownerUserId: 1, status: 1 }, name: "recipe_owner" }, { key: { ownerHouseholdId: 1, visibility: 1, status: 1 }, name: "recipe_household" }], validator: objectValidator(["name", "visibility", "status", "recipeIngredients", "steps", "tags"], { name: { bsonType: "string" }, visibility: { enum: ["catalog", "user_private", "household"] }, status: { enum: ["active", "archived"] }, recipeIngredients: { bsonType: "array" }, steps: { bsonType: "array" }, tags: { bsonType: "array" } }) },
  { name: "ingredients", indexes: [{ key: { normalizedName: 1 }, name: "ingredient_name_unique", unique: true }] },
  { name: "ingredient_aliases", indexes: [{ key: { householdId: 1, normalizedAlias: 1 }, name: "ingredient_alias_scope", unique: true }] },
  { name: "units", indexes: [{ key: { canonicalName: 1 }, name: "unit_name_unique", unique: true }] },
  { name: "tags", indexes: [{ key: { normalizedName: 1 }, name: "tag_name_unique", unique: true }] },
  { name: "favourites", indexes: [{ key: { userId: 1, recipeId: 1 }, name: "favourite_unique", unique: true }, { key: { userId: 1, createdAt: -1 }, name: "favourite_user_recent" }] },
  { name: "saved_recipe_searches", indexes: [{ key: { householdId: 1, updatedAt: -1 }, name: "saved_search_household" }] },
  { name: "collections", indexes: [{ key: { householdId: 1, name: 1 }, name: "collection_household_name" }] },
  { name: "collection_recipes", indexes: [{ key: { collectionId: 1, recipeId: 1 }, name: "collection_recipe_unique", unique: true }] },
  { name: "meal_plans", indexes: [{ key: { householdId: 1, startsOn: 1, endsOn: 1 }, name: "meal_plan_week_unique", unique: true }, { key: { householdId: 1, "items.recipeId": 1 }, name: "meal_plan_recipe" }], validator: objectValidator(["householdId", "startsOn", "endsOn", "items"], { householdId: { bsonType: "string" }, startsOn: { bsonType: "string" }, endsOn: { bsonType: "string" }, items: { bsonType: "array" } }) },
  { name: "shopping_lists", indexes: [{ key: { householdId: 1, createdAt: -1 }, name: "shopping_household_recent" }, { key: { planId: 1 }, name: "shopping_plan" }], validator: objectValidator(["householdId", "items"], { householdId: { bsonType: "string" }, planId: { bsonType: ["string", "null"] }, items: { bsonType: "array" } }) },
  { name: "shopping_list_shares", indexes: [{ key: { tokenHash: 1 }, name: "share_token_unique", unique: true }, { key: { householdId: 1, listId: 1, revokedAt: 1 }, name: "share_list_v2" }, { key: { expiresAt: 1 }, name: "share_expiry" }], validator: objectValidator(["householdId", "listId", "tokenHash", "expiresAt"], { householdId: { bsonType: "string" }, listId: { bsonType: "string" }, tokenHash: { bsonType: "string" }, expiresAt: { bsonType: "date" } }) },
  { name: "household_invitations", indexes: [{ key: { tokenHash: 1 }, name: "invitation_token_unique", unique: true }, { key: { householdId: 1, normalizedEmail: 1, status: 1 }, name: "invitation_pending" }, { key: { expiresAt: 1 }, name: "invitation_expiry" }], validator: objectValidator(["householdId", "email", "normalizedEmail", "tokenHash", "invitedByUserId", "status", "deliveryStatus", "expiresAt"], { householdId: { bsonType: "string" }, email: { bsonType: "string" }, normalizedEmail: { bsonType: "string" }, tokenHash: { bsonType: "string" }, invitedByUserId: { bsonType: "string" }, status: { enum: ["pending", "accepted", "revoked"] }, deliveryStatus: { enum: ["pending", "queued", "sending", "sent", "failed"] }, expiresAt: { bsonType: "date" } }) },
  { name: "api_keys", indexes: [{ key: { prefix: 1 }, name: "api_key_prefix_unique", unique: true }, { key: { userId: 1, createdAt: -1 }, name: "api_key_user" }], validator: objectValidator(["userId", "householdId", "prefix", "keyHash", "scopes"], { userId: { bsonType: "string" }, householdId: { bsonType: "string" }, prefix: { bsonType: "string" }, keyHash: { bsonType: "string" }, scopes: { bsonType: "array" } }) },
  { name: "api_key_events", indexes: [{ key: { apiKeyId: 1, createdAt: -1 }, name: "api_key_event_key" }] },
  { name: "auth_error_events", indexes: [{ key: { requestId: 1, createdAt: -1 }, name: "auth_error_request" }, { key: { createdAt: -1 }, name: "auth_error_recent" }, { key: { expiresAt: 1 }, name: "auth_error_expiry", expireAfterSeconds: 0 }], validator: objectValidator(["requestId", "path", "source", "message", "createdAt", "expiresAt"], { requestId: { bsonType: "string" }, path: { bsonType: "string" }, source: { enum: ["better-auth", "api-error", "auth-handler", "oauth-error-response"] }, message: { bsonType: "string" }, errorCode: { bsonType: ["string", "int", "long", "double", "null"] }, errorName: { bsonType: ["string", "null"] }, errorCodeName: { bsonType: ["string", "null"] }, status: { bsonType: ["string", "int", "long", "double", "null"] }, details: { bsonType: ["array", "null"] }, createdAt: { bsonType: "date" }, expiresAt: { bsonType: "date" } }) },
  { name: "recipe_ingestions", indexes: [{ key: { householdId: 1, userId: 1, updatedAt: -1 }, name: "ingestion_owner" }, { key: { status: 1, updatedAt: 1 }, name: "ingestion_status" }], validator: objectValidator(["householdId", "userId", "status"], { householdId: { bsonType: "string" }, userId: { bsonType: "string" }, status: { bsonType: "string" }, sourceArtifact: { bsonType: ["object", "null"] }, draft: { bsonType: ["object", "null"] } }) },
  { name: "recipe_mutation_events", indexes: [{ key: { recipeId: 1, createdAt: -1 }, name: "mutation_recipe" }, { key: { idempotencyKey: 1 }, name: "mutation_idempotency", unique: true, sparse: true }] },
  { name: "email_deliveries", indexes: [{ key: { status: 1, updatedAt: 1 }, name: "email_work_v2" }, { key: { userId: 1, createdAt: -1 }, name: "email_user_rate" }, { key: { householdId: 1, createdAt: -1 }, name: "email_household_rate" }], validator: objectValidator(["householdId", "userId", "shoppingListId", "shareId", "recipientEmail", "status"], { householdId: { bsonType: "string" }, userId: { bsonType: "string" }, shoppingListId: { bsonType: "string" }, shareId: { bsonType: "string" }, recipientEmail: { bsonType: "string" }, status: { enum: ["pending", "queued", "sending", "sent", "failed"] } }) },
  { name: "import_runs", indexes: [{ key: { sourceHash: 1, startedAt: -1 }, name: "import_source" }] },
  { name: "import_issues", indexes: [{ key: { importRunId: 1, severity: 1, reasonCode: 1 }, name: "import_issue_run" }] },
  { name: "idempotency_keys", indexes: [{ key: { key: 1 }, name: "idempotency_unique", unique: true }, { key: { expiresAt: 1 }, name: "idempotency_ttl", expireAfterSeconds: 0 }] },
];

export async function ensureMongoSchema(database: Db): Promise<void> {
  const existing = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
  for (const definition of collectionDefinitions) {
    if (!existing.has(definition.name)) {
      await database.createCollection(definition.name, definition.validator ? { validator: definition.validator, validationLevel: "moderate", validationAction: "error" } : undefined);
    } else if (definition.validator) {
      await database.command({ collMod: definition.name, validator: definition.validator, validationLevel: "moderate", validationAction: "error" });
    }
    if (definition.indexes.length) await database.collection(definition.name).createIndexes(definition.indexes);
  }
}

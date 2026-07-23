package com.tableplan.migration

import com.mongodb.client.model.IndexModel
import com.mongodb.client.model.IndexOptions
import com.mongodb.client.model.Indexes
import org.bson.Document
import java.util.concurrent.TimeUnit

data class CollectionSchema(
    val name: String,
    val indexes: List<IndexModel> = emptyList(),
    val validator: Document? = null,
    val applicationCollection: Boolean = true,
    val obsoleteIndexes: Set<String> = emptySet(),
)

data class SearchIndexSchema(
    val collection: String,
    val name: String,
    val definition: Document,
    val requiredSortableTokenFields: Set<String> = emptySet(),
)

object SchemaManifest {
    private fun index(keys: Document, name: String, unique: Boolean = false, sparse: Boolean = false) =
        IndexModel(keys, IndexOptions().name(name).unique(unique).sparse(sparse))

    private fun ttl(key: String, name: String) =
        IndexModel(
            Indexes.ascending(key),
            IndexOptions().name(name).expireAfter(0, TimeUnit.SECONDS),
        )

    private fun objectValidator(required: List<String>, properties: Document = Document()): Document =
        Document(
            "\$jsonSchema",
            Document("bsonType", "object")
                .append("required", listOf("_id") + required)
                .append(
                    "properties",
                    Document("_id", Document("bsonType", "string")).apply { putAll(properties) },
                ),
        )

    val searchIndexes =
        listOf(
            SearchIndexSchema(
                collection = "recipes",
                name = "recipes_v1",
                definition =
                    Document(
                        "mappings",
                        Document("dynamic", false)
                            .append(
                                "fields",
                                Document(
                                    "_id",
                                    Document("type", "token").append("normalizer", "none"),
                                ).append(
                                    "name",
                                    listOf(
                                        Document("type", "string"),
                                        Document("type", "token").append("normalizer", "none"),
                                    ),
                                ).append(
                                    "description",
                                    Document("type", "string"),
                                ).append(
                                    "tags",
                                    Document("type", "string"),
                                ).append(
                                    "recipeIngredients",
                                    Document("type", "document")
                                        .append(
                                            "fields",
                                            Document("ingredient", Document("type", "string"))
                                                .append("rawLine", Document("type", "string")),
                                        ),
                                ).append(
                                    "steps",
                                    Document("type", "document")
                                        .append(
                                            "fields",
                                            Document("instruction", Document("type", "string")),
                                        ),
                                ),
                            ),
                    ),
                requiredSortableTokenFields = setOf("name", "_id"),
            ),
        )

    val collections =
        listOf(
            CollectionSchema("users", listOf(index(Document("email", 1), "user_email_unique", unique = true))),
            CollectionSchema(
                "accounts",
                listOf(
                    index(Document("providerId", 1).append("accountId", 1), "account_provider_unique", unique = true),
                    index(Document("userId", 1), "account_user"),
                ),
            ),
            CollectionSchema(
                "verifications",
                listOf(
                    index(Document("identifier", 1).append("value", 1), "verification_lookup"),
                    index(Document("expiresAt", 1), "verification_expiry"),
                ),
            ),
            CollectionSchema(
                "households",
                validator =
                    objectValidator(
                        listOf("name"),
                        Document("name", Document("bsonType", "string"))
                            .append("timezone", Document("bsonType", listOf("string", "null"))),
                    ),
            ),
            CollectionSchema(
                "household_memberships",
                listOf(
                    index(Document("householdId", 1).append("userId", 1), "membership_unique", unique = true),
                    index(Document("userId", 1).append("createdAt", 1), "membership_user"),
                ),
                objectValidator(
                    listOf("householdId", "userId", "role"),
                    Document("householdId", Document("bsonType", "string"))
                        .append("userId", Document("bsonType", "string"))
                        .append("role", Document("enum", listOf("owner", "adult", "viewer")))
                        .append("relationship", Document("bsonType", listOf("string", "null"))),
                ),
            ),
            CollectionSchema(
                "user_profiles",
                listOf(index(Document("userId", 1), "profile_user_unique", unique = true, sparse = true)),
            ),
            CollectionSchema(
                "recipes",
                listOf(
                    index(Document("sourceId", 1), "recipe_source", unique = true, sparse = true),
                    index(Document("visibility", 1).append("status", 1).append("name", 1), "recipe_catalog_list"),
                    index(
                        Document("visibility", 1).append("status", 1).append("name", 1).append("_id", 1),
                        "recipe_catalog_browse",
                    ),
                    index(
                        Document("visibility", 1).append("status", 1).append("tags", 1).append("name", 1),
                        "recipe_catalog_tags_list",
                    ),
                    index(Document("ownerUserId", 1).append("status", 1), "recipe_owner"),
                    index(
                        Document("ownerUserId", 1).append("status", 1).append("name", 1).append("_id", 1),
                        "recipe_owner_browse",
                    ),
                    index(
                        Document("ownerHouseholdId", 1).append("visibility", 1).append("status", 1),
                        "recipe_household",
                    ),
                    index(
                        Document("ownerHouseholdId", 1)
                            .append("visibility", 1)
                            .append("status", 1)
                            .append("name", 1)
                            .append("_id", 1),
                        "recipe_household_browse",
                    ),
                ),
                objectValidator(
                    listOf("name", "visibility", "status", "recipeIngredients", "steps", "tags"),
                    Document("name", Document("bsonType", "string"))
                        .append("visibility", Document("enum", listOf("catalog", "user_private", "household")))
                        .append("status", Document("enum", listOf("active", "archived")))
                        .append("recipeIngredients", Document("bsonType", "array"))
                        .append("steps", Document("bsonType", "array"))
                        .append("tags", Document("bsonType", "array")),
                ),
            ),
            CollectionSchema(
                "ingredients",
                listOf(index(Document("normalizedName", 1), "ingredient_name_unique", unique = true)),
            ),
            CollectionSchema(
                "ingredient_aliases",
                listOf(
                    index(
                        Document("householdId", 1).append("normalizedAlias", 1),
                        "ingredient_alias_scope",
                        unique = true,
                    ),
                ),
            ),
            CollectionSchema("units", listOf(index(Document("canonicalName", 1), "unit_name_unique", unique = true))),
            CollectionSchema("tags", listOf(index(Document("normalizedName", 1), "tag_name_unique", unique = true))),
            CollectionSchema(
                "favourites",
                listOf(
                    index(Document("userId", 1).append("recipeId", 1), "favourite_unique", unique = true),
                    index(Document("userId", 1).append("createdAt", -1), "favourite_user_recent"),
                ),
            ),
            CollectionSchema(
                "saved_recipe_searches",
                listOf(index(Document("householdId", 1).append("updatedAt", -1), "saved_search_household")),
            ),
            CollectionSchema(
                "collections",
                listOf(index(Document("householdId", 1).append("name", 1), "collection_household_name")),
            ),
            CollectionSchema(
                "collection_recipes",
                listOf(index(Document("collectionId", 1).append("recipeId", 1), "collection_recipe_unique", unique = true)),
            ),
            CollectionSchema(
                "meal_plans",
                listOf(
                    index(
                        Document("householdId", 1).append("startsOn", 1).append("endsOn", 1),
                        "meal_plan_week_unique",
                        unique = true,
                    ),
                    index(Document("householdId", 1).append("items.recipeId", 1), "meal_plan_recipe"),
                    index(Document("householdId", 1).append("items.id", 1), "meal_plan_item"),
                ),
                objectValidator(
                    listOf("householdId", "startsOn", "endsOn", "items"),
                    Document("householdId", Document("bsonType", "string"))
                        .append("startsOn", Document("bsonType", "string"))
                        .append("endsOn", Document("bsonType", "string"))
                        .append("items", Document("bsonType", "array")),
                ),
            ),
            CollectionSchema(
                "shopping_lists",
                listOf(
                    index(Document("householdId", 1).append("createdAt", -1), "shopping_household_recent"),
                    index(Document("planId", 1), "shopping_plan"),
                    index(Document("householdId", 1).append("items.id", 1), "shopping_item"),
                ),
                objectValidator(
                    listOf("householdId", "items"),
                    Document("householdId", Document("bsonType", "string"))
                        .append("planId", Document("bsonType", listOf("string", "null")))
                        .append("items", Document("bsonType", "array")),
                ),
            ),
            CollectionSchema(
                "shopping_list_shares",
                listOf(
                    index(Document("tokenHash", 1), "share_token_unique", unique = true),
                    index(Document("householdId", 1).append("listId", 1).append("revokedAt", 1), "share_list_v2"),
                    index(Document("householdId", 1).append("listId", 1).append("createdAt", -1), "share_list_recent"),
                    index(Document("expiresAt", 1), "share_expiry"),
                ),
                objectValidator(
                    listOf("householdId", "listId", "tokenHash", "expiresAt"),
                    Document("householdId", Document("bsonType", "string"))
                        .append("listId", Document("bsonType", "string"))
                        .append("tokenHash", Document("bsonType", "string"))
                        .append("expiresAt", Document("bsonType", "date")),
                ),
            ),
            CollectionSchema(
                "household_invitations",
                listOf(
                    index(Document("tokenHash", 1), "invitation_token_unique", unique = true),
                    index(
                        Document("householdId", 1).append("normalizedEmail", 1).append("status", 1),
                        "invitation_pending",
                    ),
                    index(
                        Document("householdId", 1).append("status", 1).append("createdAt", -1),
                        "invitation_household_recent",
                    ),
                    index(Document("expiresAt", 1), "invitation_expiry"),
                ),
                objectValidator(
                    listOf(
                        "householdId",
                        "email",
                        "normalizedEmail",
                        "tokenHash",
                        "invitedByUserId",
                        "status",
                        "deliveryStatus",
                        "expiresAt",
                    ),
                    Document("householdId", Document("bsonType", "string"))
                        .append("email", Document("bsonType", "string"))
                        .append("normalizedEmail", Document("bsonType", "string"))
                        .append("tokenHash", Document("bsonType", "string"))
                        .append("invitedByUserId", Document("bsonType", "string"))
                        .append("status", Document("enum", listOf("pending", "accepted", "revoked")))
                        .append("deliveryStatus", Document("enum", listOf("pending", "queued", "sending", "sent", "failed")))
                        .append("expiresAt", Document("bsonType", "date")),
                ),
            ),
            CollectionSchema(
                "api_keys",
                listOf(
                    index(Document("prefix", 1), "api_key_prefix_unique", unique = true),
                    index(Document("userId", 1).append("createdAt", -1), "api_key_user"),
                ),
                objectValidator(
                    listOf("userId", "householdId", "prefix", "keyHash", "scopes"),
                    Document("userId", Document("bsonType", "string"))
                        .append("householdId", Document("bsonType", "string"))
                        .append("prefix", Document("bsonType", "string"))
                        .append("keyHash", Document("bsonType", "string"))
                        .append("scopes", Document("bsonType", "array")),
                ),
            ),
            CollectionSchema(
                "api_key_events",
                listOf(index(Document("apiKeyId", 1).append("createdAt", -1), "api_key_event_key")),
            ),
            CollectionSchema(
                "auth_error_events",
                listOf(
                    index(Document("requestId", 1).append("createdAt", -1), "auth_error_request"),
                    index(Document("createdAt", -1), "auth_error_recent"),
                    ttl("expiresAt", "auth_error_expiry"),
                ),
                objectValidator(
                    listOf("requestId", "path", "source", "message", "createdAt", "expiresAt"),
                    Document("requestId", Document("bsonType", "string"))
                        .append("path", Document("bsonType", "string"))
                        .append("source", Document("enum", listOf("better-auth", "api-error", "auth-handler", "oauth-error-response")))
                        .append("message", Document("bsonType", "string"))
                        .append("errorCode", Document("bsonType", listOf("string", "int", "long", "double", "null")))
                        .append("errorName", Document("bsonType", listOf("string", "null")))
                        .append("errorCodeName", Document("bsonType", listOf("string", "null")))
                        .append("status", Document("bsonType", listOf("string", "int", "long", "double", "null")))
                        .append("details", Document("bsonType", listOf("array", "null")))
                        .append("createdAt", Document("bsonType", "date"))
                        .append("expiresAt", Document("bsonType", "date")),
                ),
            ),
            CollectionSchema(
                "recipe_ingestions",
                listOf(
                    index(
                        Document("householdId", 1).append("userId", 1).append("updatedAt", -1),
                        "ingestion_owner",
                    ),
                    index(Document("status", 1).append("updatedAt", 1), "ingestion_status"),
                ),
                objectValidator(
                    listOf("householdId", "userId", "status"),
                    Document("householdId", Document("bsonType", "string"))
                        .append("userId", Document("bsonType", "string"))
                        .append("status", Document("bsonType", "string"))
                        .append("sourceArtifact", Document("bsonType", listOf("object", "null")))
                        .append("draft", Document("bsonType", listOf("object", "null"))),
                ),
            ),
            CollectionSchema(
                "recipe_mutation_events",
                listOf(
                    index(Document("recipeId", 1).append("createdAt", -1), "mutation_recipe"),
                    index(Document("idempotencyKey", 1), "mutation_idempotency", unique = true, sparse = true),
                ),
            ),
            CollectionSchema(
                "email_deliveries",
                listOf(
                    index(Document("status", 1).append("updatedAt", 1), "email_work_v2"),
                    index(Document("userId", 1).append("createdAt", -1), "email_user_rate"),
                    index(Document("householdId", 1).append("createdAt", -1), "email_household_rate"),
                ),
                objectValidator(
                    listOf("householdId", "userId", "shoppingListId", "shareId", "recipientEmail", "status"),
                    Document("householdId", Document("bsonType", "string"))
                        .append("userId", Document("bsonType", "string"))
                        .append("shoppingListId", Document("bsonType", "string"))
                        .append("shareId", Document("bsonType", "string"))
                        .append("recipientEmail", Document("bsonType", "string"))
                        .append("status", Document("enum", listOf("pending", "queued", "sending", "sent", "failed"))),
                ),
            ),
            CollectionSchema("import_runs", listOf(index(Document("sourceHash", 1).append("startedAt", -1), "import_source"))),
            CollectionSchema(
                "import_issues",
                listOf(index(Document("importRunId", 1).append("severity", 1).append("reasonCode", 1), "import_issue_run")),
            ),
            CollectionSchema(
                "idempotency_keys",
                listOf(
                    index(Document("key", 1), "idempotency_unique", unique = true),
                    ttl("expiresAt", "idempotency_ttl"),
                ),
            ),
            CollectionSchema(
                "sessions",
                listOf(ttl("expiresAt", "session_expiry"), index(Document("userId", 1), "session_user")),
                applicationCollection = false,
                obsoleteIndexes = setOf("session_token_unique"),
            ),
            CollectionSchema(
                "jobs",
                listOf(
                    index(
                        Document("status", 1).append("availableAt", 1).append("leaseExpiresAt", 1),
                        "job_claim",
                    ),
                    index(Document("idempotencyKey", 1), "job_idempotency", unique = true, sparse = true),
                ),
                applicationCollection = false,
            ),
            CollectionSchema("schema_migrations", applicationCollection = false),
        )
}

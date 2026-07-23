package com.tableplan.auth

import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.Updates
import com.tableplan.api.ApiException
import org.bson.Document
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Instant
import java.util.Date
import java.util.UUID

val API_SCOPES =
    setOf(
        "recipes:read",
        "recipes:write",
        "plans:read",
        "plans:write",
        "shopping:read",
        "shopping:write",
        "household:read",
        "admin:import",
    )

data class ApiKeyView(
    val id: String,
    val name: String,
    val prefix: String,
    val scopes: List<String>,
    val expiresAt: Instant?,
    val lastUsedAt: Instant?,
    val revokedAt: Instant?,
    val createdAt: Instant,
)

data class CreatedApiKey(
    val id: String,
    val key: String,
)

@Service
class ApiKeyService(
    database: MongoDatabase,
    private val clock: Clock,
) {
    private val keys = database.getCollection("api_keys")
    private val memberships = database.getCollection("household_memberships")

    fun create(
        principal: TableplanPrincipal,
        nameInput: String,
        environment: String,
        requestedScopes: List<String>,
        expiresAt: Instant?,
    ): CreatedApiKey {
        requireMembership(principal)
        val name = nameInput.trim()
        if (name.isBlank() || name.length > 100) throw ApiException(400, "api_key_name_invalid", "API key name is invalid.")
        if (environment !in setOf("test", "live")) throw ApiException(400, "api_key_environment_invalid", "API key environment is invalid.")
        val scopes = requestedScopes.distinct()
        if (scopes.isEmpty() || scopes.any { it !in API_SCOPES }) {
            throw ApiException(400, "api_key_scopes_invalid", "At least one valid API key scope is required.")
        }
        if (expiresAt != null && !expiresAt.isAfter(clock.instant())) {
            throw ApiException(400, "api_key_expiry_invalid", "API key expiry must be in the future.")
        }
        val id = UUID.randomUUID().toString()
        val raw = "mp_${environment}_${CryptoSupport.randomToken()}"
        val now = clock.instant()
        keys.insertOne(
            Document("_id", id)
                .append("userId", principal.userId)
                .append("householdId", principal.householdId)
                .append("name", name)
                .append("prefix", raw.take(20))
                .append("keyHash", CryptoSupport.sha256(raw))
                .append("scopes", scopes)
                .append("expiresAt", expiresAt?.let(Date::from))
                .append("revokedAt", null)
                .append("lastUsedAt", null)
                .append("createdAt", Date.from(now)),
        )
        return CreatedApiKey(id, raw)
    }

    fun list(principal: TableplanPrincipal): List<ApiKeyView> =
        keys.find(Filters.eq("userId", principal.userId))
            .sort(Document("createdAt", -1))
            .limit(200)
            .map(::toView)
            .toList()

    fun revoke(principal: TableplanPrincipal, id: String) {
        keys.updateOne(
            Filters.and(Filters.eq("_id", id), Filters.eq("userId", principal.userId), Filters.eq("revokedAt", null)),
            Updates.set("revokedAt", Date.from(clock.instant())),
        )
    }

    fun authenticate(raw: String): TableplanPrincipal? {
        if (!raw.startsWith("mp_test_") && !raw.startsWith("mp_live_")) return null
        if (raw.length > 512) return null
        val now = clock.instant()
        val document =
            keys.find(
                Filters.and(
                    Filters.eq("prefix", raw.take(20)),
                    Filters.eq("keyHash", CryptoSupport.sha256(raw)),
                    Filters.eq("revokedAt", null),
                ),
            ).first() ?: return null
        val expiresAt = (document["expiresAt"] as? Date)?.toInstant()
        if (expiresAt != null && !expiresAt.isAfter(now)) return null
        val userId = document.getString("userId")
        val householdId = document.getString("householdId")
        if (
            memberships.find(
                Filters.and(Filters.eq("userId", userId), Filters.eq("householdId", householdId)),
            ).first() == null
        ) {
            return null
        }
        val lastUsed = (document["lastUsedAt"] as? Date)?.toInstant()
        if (lastUsed == null || lastUsed.plusSeconds(300).isBefore(now)) {
            keys.updateOne(Filters.eq("_id", document.getString("_id")), Updates.set("lastUsedAt", Date.from(now)))
        }
        return TableplanPrincipal(
            userId,
            householdId,
            AuthenticationKind.API_KEY,
            document.getList("scopes", String::class.java).orEmpty().toSet(),
        )
    }

    private fun requireMembership(principal: TableplanPrincipal) {
        val exists =
            memberships.find(
                Filters.and(
                    Filters.eq("userId", principal.userId),
                    Filters.eq("householdId", principal.householdId),
                ),
            ).first()
        if (exists == null) throw ApiException(403, "household_access_denied", "Household access denied.")
    }

    private fun toView(document: Document) =
        ApiKeyView(
            id = document.getString("_id"),
            name = document.getString("name"),
            prefix = document.getString("prefix"),
            scopes = document.getList("scopes", String::class.java).orEmpty(),
            expiresAt = (document["expiresAt"] as? Date)?.toInstant(),
            lastUsedAt = (document["lastUsedAt"] as? Date)?.toInstant(),
            revokedAt = (document["revokedAt"] as? Date)?.toInstant(),
            createdAt = (document["createdAt"] as Date).toInstant(),
        )
}


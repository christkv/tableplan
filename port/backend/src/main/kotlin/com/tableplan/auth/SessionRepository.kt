package com.tableplan.auth

import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.IndexOptions
import com.mongodb.client.model.Indexes
import com.mongodb.client.model.Updates
import org.bson.Document
import org.springframework.stereotype.Repository
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Date
import java.util.concurrent.TimeUnit

data class CreatedSession(
    val token: String,
    val expiresAt: Instant,
)

@Repository
class SessionRepository(
    database: MongoDatabase,
    private val clock: Clock,
) {
    private val sessions = database.getCollection("sessions")
    private val lifetime = Duration.ofDays(30)
    private val touchInterval = Duration.ofMinutes(5)

    fun ensureIndexes() {
        sessions.createIndex(
            Indexes.ascending("expiresAt"),
            IndexOptions().name("session_expiry").expireAfter(0, TimeUnit.SECONDS),
        )
        sessions.createIndex(Indexes.ascending("userId"), IndexOptions().name("session_user"))
    }

    fun create(userId: String, householdId: String): CreatedSession {
        val token = CryptoSupport.randomToken()
        val now = clock.instant()
        val expiresAt = now.plus(lifetime)
        sessions.insertOne(
            Document("_id", CryptoSupport.sha256(token))
                .append("userId", userId)
                .append("householdId", householdId)
                .append("authVersion", CURRENT_AUTH_VERSION)
                .append("createdAt", Date.from(now))
                .append("lastSeenAt", Date.from(now))
                .append("expiresAt", Date.from(expiresAt)),
        )
        return CreatedSession(token, expiresAt)
    }

    fun resolve(token: String): TableplanPrincipal? {
        if (token.length !in 32..256) return null
        val now = clock.instant()
        val id = CryptoSupport.sha256(token)
        val document =
            sessions.find(
                Filters.and(
                    Filters.eq("_id", id),
                    Filters.eq("authVersion", CURRENT_AUTH_VERSION),
                    Filters.gt("expiresAt", Date.from(now)),
                ),
            ).first() ?: return null
        val lastSeen = (document["lastSeenAt"] as? Date)?.toInstant() ?: Instant.EPOCH
        if (lastSeen.plus(touchInterval).isBefore(now)) {
            sessions.updateOne(Filters.eq("_id", id), Updates.set("lastSeenAt", Date.from(now)))
        }
        return TableplanPrincipal(
            userId = document.getString("userId"),
            householdId = document.getString("householdId"),
            authenticationKind = AuthenticationKind.SESSION,
        )
    }

    fun revoke(token: String) {
        if (token.length in 32..256) sessions.deleteOne(Filters.eq("_id", CryptoSupport.sha256(token)))
    }

    fun revokeUser(userId: String) {
        sessions.deleteMany(Filters.eq("userId", userId))
    }

    fun switchHousehold(token: String, userId: String, householdId: String): Boolean {
        if (token.length !in 32..256) return false
        return sessions.updateOne(
            Filters.and(
                Filters.eq("_id", CryptoSupport.sha256(token)),
                Filters.eq("userId", userId),
                Filters.eq("authVersion", CURRENT_AUTH_VERSION),
                Filters.gt("expiresAt", Date.from(clock.instant())),
            ),
            Updates.combine(
                Updates.set("householdId", householdId),
                Updates.set("lastSeenAt", Date.from(clock.instant())),
            ),
        ).modifiedCount == 1L
    }

    private companion object {
        const val CURRENT_AUTH_VERSION = 2
    }
}

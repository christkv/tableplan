package com.tableplan.auth

import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.FindOneAndUpdateOptions
import com.mongodb.client.model.ReplaceOptions
import com.mongodb.client.model.ReturnDocument
import com.mongodb.client.model.Updates
import org.bson.Document
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Duration
import java.util.Date

enum class AuthTokenPurpose(
    val value: String,
    val lifetime: Duration,
) {
    EMAIL_VERIFICATION("email_verification", Duration.ofHours(24)),
    PASSWORD_RESET("password_reset", Duration.ofHours(1)),
}

@Service
class AuthTokenService(
    database: MongoDatabase,
    private val clock: Clock,
) {
    private val verifications = database.getCollection("verifications")
    private val resendCooldown = Duration.ofMinutes(1)

    fun issue(userId: String, purpose: AuthTokenPurpose): String? {
        val id = "${purpose.value}:$userId"
        val now = clock.instant()
        val existing = verifications.find(Filters.eq("_id", id)).first()
        val lastIssued = (existing?.get("createdAt") as? Date)?.toInstant()
        if (lastIssued != null && lastIssued.isAfter(now.minus(resendCooldown))) return null

        val token = CryptoSupport.randomToken()
        verifications.replaceOne(
            Filters.eq("_id", id),
            Document("_id", id)
                .append("identifier", id)
                .append("value", CryptoSupport.sha256(token))
                .append("type", purpose.value)
                .append("userId", userId)
                .append("createdAt", Date.from(now))
                .append("expiresAt", Date.from(now.plus(purpose.lifetime))),
            ReplaceOptions().upsert(true),
        )
        return token
    }

    fun consumeEmailVerification(token: String): String? {
        if (token.length !in 32..256) return null
        val now = Date.from(clock.instant())
        val tokenHash = CryptoSupport.sha256(token)
        val filter =
            Filters.and(
                Filters.eq("type", AuthTokenPurpose.EMAIL_VERIFICATION.value),
                Filters.eq("value", tokenHash),
                Filters.gt("expiresAt", now),
            )
        val consumed =
            verifications.findOneAndUpdate(
                Filters.and(filter, Filters.exists("consumedAt", false)),
                Updates.set("consumedAt", now),
                FindOneAndUpdateOptions().returnDocument(ReturnDocument.AFTER),
            )
        if (consumed != null) return consumed.getString("userId")

        // Email confirmation is idempotent so development StrictMode and browser retries remain safe.
        return verifications.find(
            Filters.and(filter, Filters.exists("consumedAt", true)),
        ).first()?.getString("userId")
    }

    fun consumePasswordReset(token: String): String? {
        if (token.length !in 32..256) return null
        return verifications.findOneAndDelete(
            Filters.and(
                Filters.eq("type", AuthTokenPurpose.PASSWORD_RESET.value),
                Filters.eq("value", CryptoSupport.sha256(token)),
                Filters.gt("expiresAt", Date.from(clock.instant())),
                Filters.exists("consumedAt", false),
            ),
        )?.getString("userId")
    }
}

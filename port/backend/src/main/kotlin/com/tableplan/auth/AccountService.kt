package com.tableplan.auth

import com.mongodb.MongoWriteException
import com.mongodb.client.MongoClient
import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.UpdateOptions
import com.mongodb.client.model.Updates
import com.tableplan.api.ApiException
import org.bson.Document
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import java.time.Clock
import java.util.Date
import java.util.Locale
import java.util.UUID

data class AccountUser(
    val id: String,
    val name: String,
    val email: String,
    val username: String,
    val householdId: String,
    val emailVerified: Boolean,
)

@Service
class AccountService(
    private val client: MongoClient,
    private val database: MongoDatabase,
    private val passwordEncoder: PasswordEncoder,
    private val clock: Clock,
) {
    private val users = database.getCollection("users")
    private val accounts = database.getCollection("accounts")
    private val memberships = database.getCollection("household_memberships")
    private val households = database.getCollection("households")
    private val profiles = database.getCollection("user_profiles")

    fun register(nameInput: String, emailInput: String, usernameInput: String, password: String): AccountUser {
        val name = nameInput.trim().replace(Regex("\\s+"), " ")
        val email = emailInput.trim().lowercase(Locale.ROOT)
        val username = usernameInput.trim().lowercase(Locale.ROOT)
        if (name.isBlank() || name.length > 100) throw ApiException(400, "name_invalid", "Name is required.")
        if (!email.matches(Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"))) {
            throw ApiException(400, "email_invalid", "Email is invalid.")
        }
        if (!username.matches(Regex("^[a-z0-9_.-]{3,32}$"))) {
            throw ApiException(400, "username_invalid", "Username must be 3–32 safe characters.")
        }
        if (password.length !in 12..200) {
            throw ApiException(400, "password_invalid", "Password must contain at least 12 characters.")
        }
        val userId = UUID.randomUUID().toString()
        val householdId = UUID.randomUUID().toString()
        val now = Date.from(clock.instant())
        try {
            client.startSession().use { session ->
                session.withTransaction {
                    users.insertOne(
                        session,
                        Document("_id", userId)
                            .append("name", name)
                            .append("email", email)
                            .append("emailVerified", false)
                            .append("username", username)
                            .append("displayUsername", usernameInput.trim())
                            .append("createdAt", now)
                            .append("updatedAt", now),
                    )
                    accounts.insertOne(
                        session,
                        Document("_id", UUID.randomUUID().toString())
                            .append("providerId", "credential")
                            .append("accountId", userId)
                            .append("userId", userId)
                            .append("password", passwordEncoder.encode(password))
                            .append("createdAt", now)
                            .append("updatedAt", now),
                    )
                    households.insertOne(
                        session,
                        Document("_id", householdId)
                            .append("name", "$name's household")
                            .append("timezone", "UTC")
                            .append("createdAt", now)
                            .append("updatedAt", now),
                    )
                    memberships.insertOne(
                        session,
                        Document("_id", UUID.randomUUID().toString())
                            .append("householdId", householdId)
                            .append("userId", userId)
                            .append("role", "owner")
                            .append("roleOrder", 0)
                            .append("relationship", "other")
                            .append("createdAt", now)
                            .append("updatedAt", now),
                    )
                    profiles.insertOne(
                        session,
                        Document("_id", userId)
                            .append("userId", userId)
                            .append("defaultHouseholdId", householdId)
                            .append("measurementSystem", "original")
                            .append("createdAt", now)
                            .append("updatedAt", now),
                    )
                }
            }
        } catch (_: MongoWriteException) {
            throw ApiException(409, "account_exists", "An account already uses that email or username.")
        }
        return AccountUser(userId, name, email, username, householdId, emailVerified = false)
    }

    fun authenticate(identifierInput: String, password: String): AccountUser {
        val identifier = identifierInput.trim().lowercase(Locale.ROOT)
        val user =
            users.find(
                Filters.or(
                    Filters.eq("email", identifier),
                    Filters.eq("username", identifier),
                ),
            ).first() ?: invalidCredentials()
        val userId = user.getString("_id")
        val account =
            accounts.find(
                Filters.and(
                    Filters.eq("userId", userId),
                    Filters.eq("providerId", "credential"),
                ),
            ).first() ?: invalidCredentials()
        val hash = account.getString("password") ?: invalidCredentials()
        if (!hash.startsWith("{bcrypt}") && !hash.startsWith("\$2")) {
            throw ApiException(
                409,
                "password_migration_required",
                "This account requires a password reset before it can sign in.",
            )
        }
        if (!passwordEncoder.matches(password, hash)) invalidCredentials()
        if (user.getBoolean("emailVerified", false) != true) {
            throw ApiException(
                403,
                "email_verification_required",
                "Confirm your email address before signing in.",
            )
        }
        return userView(user)
    }

    fun find(userId: String): AccountUser? = users.find(Filters.eq("_id", userId)).first()?.let(::userView)

    fun findByEmail(emailInput: String): AccountUser? {
        val email = emailInput.trim().lowercase(Locale.ROOT)
        return users.find(Filters.eq("email", email)).first()?.let(::userView)
    }

    fun hasCredentialAccount(userId: String): Boolean =
        accounts.find(
            Filters.and(
                Filters.eq("userId", userId),
                Filters.eq("providerId", "credential"),
            ),
        ).first() != null

    fun markEmailVerified(userId: String): Boolean =
        users.updateOne(
            Filters.eq("_id", userId),
            Updates.combine(
                Updates.set("emailVerified", true),
                Updates.set("updatedAt", Date.from(clock.instant())),
            ),
        ).matchedCount == 1L

    fun resetPassword(userId: String, password: String) {
        if (password.length !in 12..200) {
            throw ApiException(400, "password_invalid", "Password must contain at least 12 characters.")
        }
        val now = Date.from(clock.instant())
        val updated =
            accounts.updateOne(
                Filters.and(
                    Filters.eq("userId", userId),
                    Filters.eq("providerId", "credential"),
                ),
                Updates.combine(
                    Updates.set("password", passwordEncoder.encode(password)),
                    Updates.set("updatedAt", now),
                ),
            )
        if (updated.matchedCount != 1L) {
            throw ApiException(400, "password_reset_invalid", "The password reset link is invalid or expired.")
        }
        users.updateOne(
            Filters.eq("_id", userId),
            Updates.combine(
                Updates.set("emailVerified", true),
                Updates.set("updatedAt", now),
            ),
        )
    }

    fun authenticateGoogle(subject: String, emailInput: String, nameInput: String, emailVerified: Boolean): AccountUser {
        if (!emailVerified) throw ApiException(403, "oauth_email_unverified", "Google account email is not verified.")
        if (subject.isBlank()) throw ApiException(403, "oauth_subject_invalid", "Google account identity is invalid.")
        val email = emailInput.trim().lowercase(Locale.ROOT)
        val linked =
            accounts.find(
                Filters.and(Filters.eq("providerId", "google"), Filters.eq("accountId", subject)),
            ).first()
        if (linked != null) {
            markEmailVerified(linked.getString("userId"))
            return find(linked.getString("userId"))
                ?: throw ApiException(409, "oauth_account_invalid", "Linked account is unavailable.")
        }
        val existingUser = users.find(Filters.eq("email", email)).first()
        if (existingUser != null) {
            val now = Date.from(clock.instant())
            users.updateOne(
                Filters.eq("_id", existingUser.getString("_id")),
                Updates.combine(
                    Updates.set("emailVerified", true),
                    Updates.set("updatedAt", now),
                ),
            )
            val linkedSuccessfully = runCatching {
                accounts.insertOne(
                    Document("_id", UUID.randomUUID().toString())
                        .append("providerId", "google")
                        .append("accountId", subject)
                        .append("userId", existingUser.getString("_id"))
                        .append("createdAt", now)
                        .append("updatedAt", now),
                )
            }.isSuccess
            if (!linkedSuccessfully) {
                val winner =
                    accounts.find(
                        Filters.and(Filters.eq("providerId", "google"), Filters.eq("accountId", subject)),
                    ).first()
                if (winner?.getString("userId") != existingUser.getString("_id")) {
                    throw ApiException(409, "oauth_link_conflict", "Google account is already linked.")
                }
            }
            return find(existingUser.getString("_id"))
                ?: throw ApiException(409, "oauth_account_invalid", "Linked account is unavailable.")
        }
        if (!email.matches(Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"))) {
            throw ApiException(403, "oauth_email_invalid", "Google account email is invalid.")
        }
        val name = nameInput.trim().replace(Regex("\\s+"), " ").take(100).ifBlank { email.substringBefore("@") }
        val userId = UUID.randomUUID().toString()
        val householdId = UUID.randomUUID().toString()
        val baseUsername =
            email.substringBefore("@").lowercase().replace(Regex("[^a-z0-9_.-]"), "").take(20)
                .ifBlank { "member" }
        val username = "$baseUsername-${userId.take(7)}"
        val now = Date.from(clock.instant())
        client.startSession().use { session ->
            session.withTransaction {
                users.insertOne(
                    session,
                    Document("_id", userId)
                        .append("name", name)
                        .append("email", email)
                        .append("emailVerified", true)
                        .append("username", username)
                        .append("displayUsername", username)
                        .append("createdAt", now)
                        .append("updatedAt", now),
                )
                accounts.insertOne(
                    session,
                    Document("_id", UUID.randomUUID().toString())
                        .append("providerId", "google")
                        .append("accountId", subject)
                        .append("userId", userId)
                        .append("createdAt", now)
                        .append("updatedAt", now),
                )
                households.insertOne(
                    session,
                    Document("_id", householdId)
                        .append("name", "$name's household")
                        .append("timezone", "UTC")
                        .append("createdAt", now)
                        .append("updatedAt", now),
                )
                memberships.insertOne(
                    session,
                    Document("_id", UUID.randomUUID().toString())
                        .append("householdId", householdId)
                        .append("userId", userId)
                        .append("role", "owner")
                        .append("relationship", "other")
                        .append("createdAt", now)
                        .append("updatedAt", now),
                )
                profiles.insertOne(
                    session,
                    Document("_id", userId)
                        .append("userId", userId)
                        .append("defaultHouseholdId", householdId)
                        .append("measurementSystem", "original")
                        .append("createdAt", now)
                        .append("updatedAt", now),
                )
            }
        }
        return AccountUser(userId, name, email, username, householdId, emailVerified = true)
    }

    fun canAccessHousehold(userId: String, householdId: String): Boolean =
        memberships.find(
            Filters.and(Filters.eq("userId", userId), Filters.eq("householdId", householdId)),
        ).first() != null

    fun setDefaultHousehold(userId: String, householdId: String) {
        if (!canAccessHousehold(userId, householdId)) {
            throw ApiException(403, "household_access_denied", "Household access denied.")
        }
        profiles.updateOne(
            Filters.eq("userId", userId),
            Updates.combine(
                Updates.set("defaultHouseholdId", householdId),
                Updates.set("updatedAt", Date.from(clock.instant())),
                Updates.setOnInsert("_id", userId),
                Updates.setOnInsert("userId", userId),
            ),
            UpdateOptions().upsert(true),
        )
    }

    private fun userView(user: Document): AccountUser {
        val userId = user.getString("_id")
        val profile = profiles.find(Filters.eq("userId", userId)).first()
        val preferred = profile?.getString("defaultHouseholdId")
        val membership =
            preferred?.let {
                memberships.find(Filters.and(Filters.eq("userId", userId), Filters.eq("householdId", it))).first()
            } ?: memberships.find(Filters.eq("userId", userId)).sort(Document("createdAt", 1)).first()
            ?: throw ApiException(409, "household_missing", "The account has no household.")
        return AccountUser(
            id = userId,
            name = user.getString("name").orEmpty(),
            email = user.getString("email").orEmpty(),
            username = user.getString("username") ?: user.getString("email").orEmpty(),
            householdId = membership.getString("householdId"),
            emailVerified = user.getBoolean("emailVerified", false) == true,
        )
    }

    private fun invalidCredentials(): Nothing =
        throw ApiException(401, "invalid_credentials", "The username/email or password is incorrect.")
}

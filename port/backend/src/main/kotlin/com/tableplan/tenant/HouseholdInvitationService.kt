package com.tableplan.tenant

import com.mongodb.client.MongoClient
import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.Updates
import com.tableplan.api.ApiException
import com.tableplan.auth.AccountService
import com.tableplan.auth.CryptoSupport
import com.tableplan.auth.TableplanPrincipal
import org.bson.Document
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Date
import java.util.Locale
import java.util.UUID

data class CreatedInvitation(
    val id: String,
    val token: String,
    val email: String,
    val role: String,
    val relationship: String,
    val expiresAt: Instant,
)

data class InvitationInfo(
    val id: String,
    val householdName: String,
    val email: String,
    val role: String,
    val relationship: String,
    val status: String,
    val expiresAt: Instant,
)

data class PendingInvitationView(
    val id: String,
    val email: String,
    val role: String,
    val relationship: String,
    val status: String,
    val deliveryStatus: String,
    val expiresAt: Instant,
    val createdAt: Instant,
)

@Service
class HouseholdInvitationService(
    private val client: MongoClient,
    private val database: MongoDatabase,
    private val accounts: AccountService,
    private val clock: Clock,
) {
    private val invitations = database.getCollection("household_invitations")
    private val memberships = database.getCollection("household_memberships")
    private val households = database.getCollection("households")
    private val profiles = database.getCollection("user_profiles")

    fun create(
        principal: TableplanPrincipal,
        emailInput: String,
        role: String,
        relationship: String,
    ): CreatedInvitation {
        val member = requireManager(principal)
        if (role !in setOf("adult", "viewer") || (member.getString("role") != "owner" && role == "adult")) {
            throw ApiException(403, "invitation_role_denied", "You cannot invite that household role.")
        }
        if (relationship !in setOf("spouse", "child", "flatmate", "other")) {
            throw ApiException(400, "invitation_relationship_invalid", "Household relationship is invalid.")
        }
        val email = emailInput.trim().lowercase(Locale.ROOT)
        if (!email.matches(Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"))) {
            throw ApiException(400, "email_invalid", "Email is invalid.")
        }
        val token = CryptoSupport.randomToken()
        val id = UUID.randomUUID().toString()
        val now = clock.instant()
        val expiresAt = now.plus(7, ChronoUnit.DAYS)
        invitations.updateMany(
            Filters.and(
                Filters.eq("householdId", principal.householdId),
                Filters.eq("normalizedEmail", email),
                Filters.eq("status", "pending"),
            ),
            Updates.combine(Updates.set("status", "revoked"), Updates.set("updatedAt", Date.from(now))),
        )
        invitations.insertOne(
            Document("_id", id)
                .append("householdId", principal.householdId)
                .append("email", email)
                .append("normalizedEmail", email)
                .append("role", role)
                .append("relationship", relationship)
                .append("tokenHash", CryptoSupport.sha256(token))
                .append("invitedByUserId", principal.userId)
                .append("status", "pending")
                .append("deliveryStatus", "pending")
                .append("expiresAt", Date.from(expiresAt))
                .append("createdAt", Date.from(now))
                .append("updatedAt", Date.from(now)),
        )
        return CreatedInvitation(id, token, email, role, relationship, expiresAt)
    }

    fun inspect(token: String): InvitationInfo {
        val invitation = pending(token)
        val household = households.find(Filters.eq("_id", invitation.getString("householdId"))).first()
            ?: throw ApiException(404, "invitation_invalid", "Invitation is invalid or expired.")
        return InvitationInfo(
            invitation.getString("_id"),
            household.getString("name"),
            invitation.getString("email"),
            invitation.getString("role"),
            invitation.getString("relationship") ?: "other",
            invitation.getString("status"),
            (invitation["expiresAt"] as Date).toInstant(),
        )
    }

    fun accept(principal: TableplanPrincipal, token: String): String {
        val account = accounts.find(principal.userId)
            ?: throw ApiException(404, "user_not_found", "User not found.")
        val invitation = pending(token)
        if (!account.email.equals(invitation.getString("normalizedEmail"), ignoreCase = true)) {
            throw ApiException(403, "invitation_email_mismatch", "Invitation belongs to a different account.")
        }
        val householdId = invitation.getString("householdId")
        val now = Date.from(clock.instant())
        client.startSession().use { session ->
            session.withTransaction {
                val claimed =
                    invitations.updateOne(
                        session,
                        Filters.and(
                            Filters.eq("_id", invitation.getString("_id")),
                            Filters.eq("status", "pending"),
                            Filters.gt("expiresAt", now),
                        ),
                        Updates.combine(
                            Updates.set("status", "accepted"),
                            Updates.set("acceptedByUserId", principal.userId),
                            Updates.set("acceptedAt", now),
                            Updates.set("updatedAt", now),
                        ),
                    )
                if (claimed.modifiedCount != 1L) {
                    throw ApiException(409, "invitation_already_used", "Invitation was already used.")
                }
                memberships.updateOne(
                    session,
                    Filters.and(Filters.eq("householdId", householdId), Filters.eq("userId", principal.userId)),
                    Updates.combine(
                        Updates.setOnInsert("_id", UUID.randomUUID().toString()),
                        Updates.setOnInsert("householdId", householdId),
                        Updates.setOnInsert("userId", principal.userId),
                        Updates.setOnInsert("role", invitation.getString("role")),
                        Updates.setOnInsert("relationship", invitation.getString("relationship") ?: "other"),
                        Updates.setOnInsert("createdAt", now),
                        Updates.set("updatedAt", now),
                    ),
                    com.mongodb.client.model.UpdateOptions().upsert(true),
                )
                profiles.updateOne(
                    session,
                    Filters.eq("userId", principal.userId),
                    Updates.combine(
                        Updates.set("defaultHouseholdId", householdId),
                        Updates.set("updatedAt", now),
                    ),
                )
            }
        }
        return householdId
    }

    fun revoke(principal: TableplanPrincipal, invitationId: String): Boolean {
        requireManager(principal)
        return invitations.updateOne(
            Filters.and(
                Filters.eq("_id", invitationId),
                Filters.eq("householdId", principal.householdId),
                Filters.eq("status", "pending"),
            ),
            Updates.combine(
                Updates.set("status", "revoked"),
                Updates.set("revokedAt", Date.from(clock.instant())),
                Updates.set("updatedAt", Date.from(clock.instant())),
            ),
        ).modifiedCount == 1L
    }

    fun list(principal: TableplanPrincipal): List<PendingInvitationView> {
        requireManager(principal)
        return invitations.find(
            Filters.and(
                Filters.eq("householdId", principal.householdId),
                Filters.eq("status", "pending"),
            ),
        ).sort(Document("createdAt", -1)).limit(100).map {
            PendingInvitationView(
                id = it.getString("_id"),
                email = it.getString("email"),
                role = it.getString("role"),
                relationship = it.getString("relationship") ?: "other",
                status = it.getString("status"),
                deliveryStatus = it.getString("deliveryStatus") ?: "pending",
                expiresAt = (it["expiresAt"] as Date).toInstant(),
                createdAt = (it["createdAt"] as Date).toInstant(),
            )
        }.toList()
    }

    private fun pending(token: String): Document {
        if (token.length !in 32..256) throw ApiException(404, "invitation_invalid", "Invitation is invalid or expired.")
        return invitations.find(
            Filters.and(
                Filters.eq("tokenHash", CryptoSupport.sha256(token)),
                Filters.eq("status", "pending"),
                Filters.gt("expiresAt", Date.from(clock.instant())),
            ),
        ).first() ?: throw ApiException(404, "invitation_invalid", "Invitation is invalid or expired.")
    }

    private fun requireManager(principal: TableplanPrincipal): Document {
        val member = memberships.find(
            Filters.and(Filters.eq("householdId", principal.householdId), Filters.eq("userId", principal.userId)),
        ).first() ?: throw ApiException(403, "household_access_denied", "Household access denied.")
        if (member.getString("role") !in setOf("owner", "adult")) {
            throw ApiException(403, "household_role_denied", "Household manager access is required.")
        }
        return member
    }
}

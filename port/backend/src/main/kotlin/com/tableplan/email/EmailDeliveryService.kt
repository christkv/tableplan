package com.tableplan.email

import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.FindOneAndUpdateOptions
import com.mongodb.client.model.ReturnDocument
import com.mongodb.client.model.Updates
import com.tableplan.api.ApiException
import com.tableplan.auth.AccountService
import com.tableplan.auth.TableplanPrincipal
import com.tableplan.config.TableplanProperties
import com.tableplan.jobs.JobService
import com.tableplan.planning.MembershipGuard
import com.tableplan.sharing.ShoppingShareService
import org.bson.Document
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Instant
import java.util.Date
import java.util.UUID

data class EmailDeliveryView(
    val id: String,
    val shoppingListId: String,
    val shareId: String,
    val recipientEmail: String,
    val status: String,
    val attemptCount: Int,
    val lastError: String?,
    val queuedAt: Instant?,
    val sentAt: Instant?,
    val createdAt: Instant,
)

@Service
class EmailDeliveryService(
    private val database: MongoDatabase,
    private val accounts: AccountService,
    private val shares: ShoppingShareService,
    private val cipher: TokenCipher,
    private val jobs: JobService,
    private val membership: MembershipGuard,
    private val clock: Clock,
    private val properties: TableplanProperties,
    private val sender: EmailSender,
) {
    private val deliveries = database.getCollection("email_deliveries")

    fun create(principal: TableplanPrincipal, listId: String, expiresInDays: Int): EmailDeliveryView {
        membership.require(principal)
        val user = accounts.find(principal.userId) ?: throw ApiException(404, "user_not_found", "User not found.")
        val share = shares.create(principal, listId, expiresInDays)
        val encrypted =
            runCatching { cipher.encrypt(share.token) }
                .getOrElse {
                    throw ApiException(503, "email_not_configured", "Email delivery is not configured.")
                }
        val id = UUID.randomUUID().toString()
        val now = Date.from(clock.instant())
        deliveries.insertOne(
            Document("_id", id)
                .append("householdId", principal.householdId)
                .append("userId", principal.userId)
                .append("shoppingListId", listId)
                .append("shareId", share.id)
                .append("recipientEmail", user.email)
                .append("encryptedShareToken", encrypted)
                .append("status", "queued")
                .append("attemptCount", 0)
                .append("lastError", null)
                .append("queuedAt", now)
                .append("sentAt", null)
                .append("createdAt", now)
                .append("updatedAt", now),
        )
        jobs.publish(ShoppingEmailJobHandler.TYPE, Document("deliveryId", id), "shopping-email:$id")
        return get(principal, id)!!
    }

    fun get(principal: TableplanPrincipal, id: String): EmailDeliveryView? {
        membership.require(principal)
        return deliveries.find(
            Filters.and(
                Filters.eq("_id", id),
                Filters.eq("householdId", principal.householdId),
                Filters.eq("userId", principal.userId),
            ),
        ).first()?.let(::view)
    }

    internal fun send(deliveryId: String) {
        val delivery =
            deliveries.findOneAndUpdate(
                Filters.and(
                    Filters.eq("_id", deliveryId),
                    Filters.`in`("status", listOf("queued", "failed")),
                ),
                Updates.combine(
                    Updates.set("status", "sending"),
                    Updates.inc("attemptCount", 1),
                    Updates.set("updatedAt", Date.from(clock.instant())),
                ),
                FindOneAndUpdateOptions().returnDocument(ReturnDocument.AFTER),
            ) ?: return
        val token = cipher.decrypt(delivery.getString("encryptedShareToken"))
        val url =
            "${properties.publicOrigin.trimEnd('/')}/shared/shopping?shareId=${delivery.getString("shareId")}&token=$token"
        val providerId =
            sender.send(
                delivery.getString("recipientEmail"),
                "Your Tableplan shopping list",
                "<p>Your shopping list is ready.</p><p><a href=\"$url\">Open shopping list</a></p>",
                "Your shopping list is ready: $url",
            )
        deliveries.updateOne(
            Filters.and(Filters.eq("_id", deliveryId), Filters.eq("status", "sending")),
            Updates.combine(
                Updates.set("status", "sent"),
                Updates.set("providerMessageId", providerId),
                Updates.set("sentAt", Date.from(clock.instant())),
                Updates.unset("encryptedShareToken"),
                Updates.set("updatedAt", Date.from(clock.instant())),
            ),
        )
    }

    private fun view(document: Document) =
        EmailDeliveryView(
            id = document.getString("_id"),
            shoppingListId = document.getString("shoppingListId"),
            shareId = document.getString("shareId"),
            recipientEmail = document.getString("recipientEmail"),
            status = document.getString("status"),
            attemptCount = (document["attemptCount"] as? Number)?.toInt() ?: 0,
            lastError = document.getString("lastError"),
            queuedAt = (document["queuedAt"] as? Date)?.toInstant(),
            sentAt = (document["sentAt"] as? Date)?.toInstant(),
            createdAt = (document["createdAt"] as Date).toInstant(),
        )
}


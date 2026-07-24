package com.tableplan.email

import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.FindOneAndUpdateOptions
import com.mongodb.client.model.ReturnDocument
import com.mongodb.client.model.Updates
import com.tableplan.api.ApiException
import com.tableplan.auth.AccountService
import com.tableplan.auth.AuthenticationKind
import com.tableplan.auth.TableplanPrincipal
import com.tableplan.config.TableplanProperties
import com.tableplan.jobs.JobService
import com.tableplan.planning.MembershipGuard
import com.tableplan.sharing.ShoppingShareService
import com.tableplan.shopping.ShoppingItem
import com.tableplan.shopping.ShoppingList
import com.tableplan.shopping.ShoppingService
import org.bson.Document
import org.bson.conversions.Bson
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Duration
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
    private val emailRenderer: BrandedEmailRenderer,
    private val shopping: ShoppingService,
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
        val now = clock.instant()
        val delivery =
            deliveries.findOneAndUpdate(
                emailDeliveryClaimFilter(deliveryId, now),
                Updates.combine(
                    Updates.set("status", "sending"),
                    Updates.inc("attemptCount", 1),
                    Updates.set("updatedAt", Date.from(now)),
                ),
                FindOneAndUpdateOptions().returnDocument(ReturnDocument.AFTER),
            ) ?: return
        try {
            val token = cipher.decrypt(delivery.getString("encryptedShareToken"))
            val url =
                "${properties.publicOrigin.trimEnd('/')}/shared/shopping?shareId=${delivery.getString("shareId")}&token=$token"
            val principal =
                TableplanPrincipal(
                    userId = delivery.getString("userId"),
                    householdId = delivery.getString("householdId"),
                    authenticationKind = AuthenticationKind.SESSION,
                )
            val shoppingList =
                shopping.getById(principal, delivery.getString("shoppingListId"))
                    ?: error("shopping_list_missing")
            val email =
                emailRenderer.render(
                    BrandedEmailTemplate(
                        preheader = "${shoppingList.name} is ready",
                        eyebrow = "Ready for the shop",
                        heading = "Your shopping list is ready",
                        paragraphs =
                            listOf(
                                "Everything from your meal plan is gathered into one practical checklist.",
                                "The full list is below, or open the live version to tick items off as you shop.",
                            ),
                        actionLabel = "Open live shopping list",
                        actionUrl = url,
                        note = "This is a private shopping-list link. Please only share it with people you trust.",
                        checklist = shoppingList.toEmailChecklist(),
                    ),
                )
            val providerId =
                sender.send(
                    delivery.getString("recipientEmail"),
                    shoppingList.name,
                    email.html,
                    email.text,
                )
            deliveries.updateOne(
                Filters.and(Filters.eq("_id", deliveryId), Filters.eq("status", "sending")),
                Updates.combine(
                    Updates.set("status", "sent"),
                    Updates.set("providerMessageId", providerId),
                    Updates.set("sentAt", Date.from(clock.instant())),
                    Updates.unset("lastError"),
                    Updates.unset("encryptedShareToken"),
                    Updates.set("updatedAt", Date.from(clock.instant())),
                ),
            )
        } catch (error: Exception) {
            deliveries.updateOne(
                Filters.and(Filters.eq("_id", deliveryId), Filters.eq("status", "sending")),
                Updates.combine(
                    Updates.set("status", "failed"),
                    Updates.set("lastError", emailDeliveryFailureCode(error)),
                    Updates.set("updatedAt", Date.from(clock.instant())),
                ),
            )
            throw error
        }
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

internal fun ShoppingList.toEmailChecklist(): BrandedEmailChecklist {
    val remaining = items.count { !it.checked }
    return BrandedEmailChecklist(
        title = name,
        summary = "$remaining left · ${items.size} total",
        items =
            items.map { item ->
                BrandedEmailChecklistItem(
                    name = item.name,
                    quantity = item.emailQuantity(),
                    checked = item.checked,
                    detail =
                        if (item.unresolved) {
                            item.sources.firstOrNull()?.rawLine?.let { "Original: $it" }
                        } else {
                            item.sources
                                .map { it.recipeName }
                                .distinct()
                                .takeIf { it.isNotEmpty() }
                                ?.joinToString(", ", prefix = "From: ")
                        },
                )
            },
    )
}

private fun ShoppingItem.emailQuantity(): String {
    val minimum = quantityMin?.let(::formatEmailQuantity) ?: return ""
    val maximum = quantityMax?.let(::formatEmailQuantity)
    return buildString {
        append(minimum)
        if (maximum != null) {
            append('–')
            append(maximum)
        }
        unitId?.takeIf(String::isNotBlank)?.let {
            append(' ')
            append(it)
        }
    }
}

private fun formatEmailQuantity(value: String): String =
    value.toBigDecimalOrNull()
        ?.setScale(3, java.math.RoundingMode.HALF_UP)
        ?.stripTrailingZeros()
        ?.toPlainString()
        ?: value

internal val STALE_EMAIL_SENDING_AFTER: Duration = Duration.ofMinutes(2)

internal fun emailDeliveryClaimFilter(
    deliveryId: String,
    now: Instant,
): Bson =
    Filters.and(
        Filters.eq("_id", deliveryId),
        Filters.or(
            Filters.`in`("status", listOf("queued", "failed")),
            Filters.and(
                Filters.eq("status", "sending"),
                Filters.lte("updatedAt", Date.from(now.minus(STALE_EMAIL_SENDING_AFTER))),
            ),
        ),
    )

internal fun emailDeliveryFailureCode(error: Throwable): String =
    "email_send_failed:" +
        when (error) {
            is CloudflareEmailException -> error.code
            else -> error.javaClass.simpleName
        }.take(150)

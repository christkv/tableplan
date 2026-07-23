package com.tableplan.sharing

import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.FindOneAndUpdateOptions
import com.mongodb.client.model.ReturnDocument
import com.mongodb.client.model.Updates
import com.tableplan.api.ApiException
import com.tableplan.auth.CryptoSupport
import com.tableplan.auth.TableplanPrincipal
import com.tableplan.planning.MembershipGuard
import com.tableplan.shopping.ShoppingItem
import com.tableplan.shopping.ShoppingSource
import org.bson.Document
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Date
import java.util.UUID

data class CreatedShare(
    val id: String,
    val token: String,
    val expiresAt: Instant,
)

data class ShareView(
    val id: String,
    val expiresAt: Instant,
    val revokedAt: Instant?,
    val createdAt: Instant,
)

data class ResolvedShare(
    val id: String,
    val householdId: String,
    val listId: String,
    val expiresAt: Instant,
)

data class PublicShoppingList(
    val id: String,
    val name: String,
    val measurementSystem: String,
    val updatedAt: Instant,
    val items: List<ShoppingItem>,
)

data class PublicShoppingItemUpdate(
    val item: ShoppingItem,
    val updatedAt: Instant,
)

@Service
class ShoppingShareService(
    database: MongoDatabase,
    private val membership: MembershipGuard,
    private val clock: Clock,
) {
    private val shares = database.getCollection("shopping_list_shares")
    private val lists = database.getCollection("shopping_lists")

    fun create(principal: TableplanPrincipal, listId: String, expiresInDays: Int): CreatedShare {
        membership.require(principal)
        if (expiresInDays !in setOf(3, 7, 14, 30)) {
            throw ApiException(400, "share_lifetime_invalid", "Share lifetime is invalid.")
        }
        if (
            lists.find(
                Filters.and(Filters.eq("_id", listId), Filters.eq("householdId", principal.householdId)),
            ).first() == null
        ) {
            throw ApiException(404, "shopping_list_not_found", "Shopping list not found.")
        }
        val id = UUID.randomUUID().toString()
        val token = CryptoSupport.randomToken()
        val now = clock.instant()
        val expiry = now.plus(expiresInDays.toLong(), ChronoUnit.DAYS)
        shares.insertOne(
            Document("_id", id)
                .append("householdId", principal.householdId)
                .append("listId", listId)
                .append("tokenHash", CryptoSupport.sha256(token))
                .append("expiresAt", Date.from(expiry))
                .append("revokedAt", null)
                .append("lastUsedAt", null)
                .append("createdByUserId", principal.userId)
                .append("createdAt", Date.from(now))
                .append("updatedAt", Date.from(now)),
        )
        return CreatedShare(id, token, expiry)
    }

    fun list(principal: TableplanPrincipal, listId: String): List<ShareView> {
        membership.require(principal)
        return shares.find(
            Filters.and(
                Filters.eq("householdId", principal.householdId),
                Filters.eq("listId", listId),
            ),
        ).sort(Document("createdAt", -1)).limit(100).map {
            ShareView(
                it.getString("_id"),
                (it["expiresAt"] as Date).toInstant(),
                (it["revokedAt"] as? Date)?.toInstant(),
                (it["createdAt"] as Date).toInstant(),
            )
        }.toList()
    }

    fun revoke(principal: TableplanPrincipal, listId: String, shareId: String): Boolean {
        membership.require(principal)
        return shares.updateOne(
            Filters.and(
                Filters.eq("_id", shareId),
                Filters.eq("householdId", principal.householdId),
                Filters.eq("listId", listId),
                Filters.eq("revokedAt", null),
            ),
            Updates.combine(
                Updates.set("revokedAt", Date.from(clock.instant())),
                Updates.set("updatedAt", Date.from(clock.instant())),
            ),
        ).modifiedCount == 1L
    }

    fun resolve(token: String, expectedShareId: String? = null): ResolvedShare? {
        if (token.length !in 32..256) return null
        val now = clock.instant()
        val filters =
            mutableListOf(
                Filters.eq("tokenHash", CryptoSupport.sha256(token)),
                Filters.eq("revokedAt", null),
                Filters.gt("expiresAt", Date.from(now)),
            )
        if (expectedShareId != null) filters += Filters.eq("_id", expectedShareId)
        val share = shares.find(Filters.and(filters)).first() ?: return null
        shares.updateOne(Filters.eq("_id", share.getString("_id")), Updates.set("lastUsedAt", Date.from(now)))
        return ResolvedShare(
            share.getString("_id"),
            share.getString("householdId"),
            share.getString("listId"),
            (share["expiresAt"] as Date).toInstant(),
        )
    }

    fun publicList(share: ResolvedShare): PublicShoppingList? {
        if (!share.expiresAt.isAfter(clock.instant())) return null
        val document =
            lists.find(
                Filters.and(
                    Filters.eq("_id", share.listId),
                    Filters.eq("householdId", share.householdId),
                ),
            ).first() ?: return null
        return PublicShoppingList(
            document.getString("_id"),
            document.getString("name"),
            document.getString("measurementSystem") ?: "original",
            (document["updatedAt"] as Date).toInstant(),
            document.getList("items", Document::class.java).orEmpty().map(::publicItem),
        )
    }

    fun toggle(share: ResolvedShare, itemId: String, checked: Boolean): PublicShoppingItemUpdate {
        if (!share.expiresAt.isAfter(clock.instant())) {
            throw ApiException(401, "share_expired", "Share has expired.")
        }
        val updated =
            lists.findOneAndUpdate(
                Filters.and(
                    Filters.eq("_id", share.listId),
                    Filters.eq("householdId", share.householdId),
                    Filters.eq("items.id", itemId),
                ),
                Updates.combine(
                    Updates.set("items.$[item].checked", checked),
                    Updates.set("updatedAt", Date.from(clock.instant())),
                ),
                FindOneAndUpdateOptions()
                    .arrayFilters(listOf(Document("item.id", itemId)))
                    .returnDocument(ReturnDocument.AFTER),
            ) ?: throw ApiException(404, "shopping_item_not_found", "Shopping item not found.")
        val item = updated.getList("items", Document::class.java).orEmpty().first { it.getString("id") == itemId }
        return PublicShoppingItemUpdate(publicItem(item), (updated["updatedAt"] as Date).toInstant())
    }

    private fun publicItem(item: Document) =
        ShoppingItem(
            id = item.getString("id"),
            name = item.getString("name"),
            quantityMin = item.getString("quantityMin"),
            quantityMax = item.getString("quantityMax"),
            unitId = item.getString("baseUnitId"),
            checked = item.getBoolean("checked", false),
            unresolved = item.getBoolean("unresolved", false),
            sources = emptyList(),
        )
}

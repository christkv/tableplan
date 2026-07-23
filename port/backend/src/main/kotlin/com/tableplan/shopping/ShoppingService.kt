package com.tableplan.shopping

import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.FindOneAndUpdateOptions
import com.mongodb.client.model.ReturnDocument
import com.mongodb.client.model.Updates
import com.tableplan.api.ApiException
import com.tableplan.auth.TableplanPrincipal
import com.tableplan.config.PerformanceMetrics
import com.tableplan.planning.MembershipGuard
import com.tableplan.planning.PlanService
import com.tableplan.quantity.QuantitySupport
import com.tableplan.recipe.RecipeAccess
import com.tableplan.recipe.RecipeService
import org.bson.Document
import org.springframework.stereotype.Service
import java.math.BigDecimal
import java.time.Clock
import java.time.Instant
import java.util.Date
import java.util.UUID

data class ShoppingSource(
    val recipeId: String,
    val recipeName: String,
    val rawLine: String,
)

data class ShoppingItem(
    val id: String,
    val name: String,
    val quantityMin: String?,
    val quantityMax: String?,
    val unitId: String?,
    val checked: Boolean,
    val unresolved: Boolean,
    val sources: List<ShoppingSource>,
)

data class ShoppingPlan(
    val id: String,
    val name: String,
    val startsOn: String,
    val endsOn: String,
    val mealCount: Int,
)

data class ShoppingList(
    val id: String,
    val name: String,
    val measurementSystem: String,
    val generatedAt: Instant,
    val updatedAt: Instant,
    val version: Long,
    val plan: ShoppingPlan?,
    val items: List<ShoppingItem>,
)

data class ShoppingItemUpdate(
    val item: ShoppingItem,
    val version: Long,
    val updatedAt: Instant,
)

private data class Aggregate(
    val key: String,
    val name: String,
    var min: BigDecimal?,
    var max: BigDecimal?,
    val unitId: String?,
    val unresolved: Boolean,
    val sources: MutableList<ShoppingSource>,
)

@Service
class ShoppingService(
    private val database: MongoDatabase,
    private val plans: PlanService,
    private val recipes: RecipeService,
    private val membership: MembershipGuard,
    private val clock: Clock,
    private val metrics: PerformanceMetrics,
) {
    private val lists = database.getCollection("shopping_lists")

    fun generate(
        principal: TableplanPrincipal,
        planId: String,
        measurementSystem: String,
    ): ShoppingList {
        membership.require(principal)
        requireMeasurement(measurementSystem)
        val plan =
            plans.getById(principal, planId)
                ?: throw ApiException(404, "plan_not_found", "Meal plan not found.")
        val now = clock.instant()
        val id = UUID.randomUUID().toString()
        val items = aggregate(principal, planId, emptyMap(), measurementSystem)
        lists.insertOne(
            Document("_id", id)
                .append("householdId", principal.householdId)
                .append("planId", planId)
                .append("name", "Shopping for ${plan.name}")
                .append("startsOn", plan.startsOn)
                .append("endsOn", plan.endsOn)
                .append("measurementSystem", measurementSystem)
                .append("items", items)
                .append("version", 0L)
                .append("createdAt", Date.from(now))
                .append("updatedAt", Date.from(now)),
        )
        return getById(principal, id)!!
    }

    fun refresh(principal: TableplanPrincipal, listId: String): ShoppingList {
        membership.require(principal)
        val current =
            lists.find(
                Filters.and(Filters.eq("_id", listId), Filters.eq("householdId", principal.householdId)),
            ).first() ?: throw ApiException(404, "shopping_list_not_found", "Shopping list not found.")
        val checked =
            current.getList("items", Document::class.java).orEmpty()
                .associate { it.getString("key") to (it.getBoolean("checked", false)) }
        val updated =
            lists.findOneAndUpdate(
                Filters.and(
                    Filters.eq("_id", listId),
                    Filters.eq("householdId", principal.householdId),
                    Filters.eq("version", (current["version"] as? Number)?.toLong() ?: 0L),
                ),
                Updates.combine(
                    Updates.set(
                        "items",
                        aggregate(
                            principal,
                            current.getString("planId"),
                            checked,
                            current.getString("measurementSystem") ?: "original",
                        ),
                    ),
                    Updates.inc("version", 1L),
                    Updates.set("updatedAt", Date.from(clock.instant())),
                ),
                FindOneAndUpdateOptions().returnDocument(ReturnDocument.AFTER),
            ) ?: throw ApiException(409, "shopping_list_conflict", "Shopping list changed. Refresh and retry.")
        return view(updated, principal)
    }

    fun latest(principal: TableplanPrincipal): ShoppingList? {
        membership.require(principal)
        return lists.find(Filters.eq("householdId", principal.householdId))
            .sort(Document("createdAt", -1))
            .first()
            ?.let { view(it, principal) }
    }

    fun getById(principal: TableplanPrincipal, id: String): ShoppingList? {
        membership.require(principal)
        return lists.find(
            Filters.and(Filters.eq("_id", id), Filters.eq("householdId", principal.householdId)),
        ).first()?.let { view(it, principal) }
    }

    fun toggle(principal: TableplanPrincipal, itemId: String, checked: Boolean): ShoppingItemUpdate {
        membership.require(principal)
        val updated =
            lists.findOneAndUpdate(
                Filters.and(
                    Filters.eq("householdId", principal.householdId),
                    Filters.eq("items.id", itemId),
                ),
                Updates.combine(
                    Updates.set("items.$[item].checked", checked),
                    Updates.set("items.$[item].updatedAt", Date.from(clock.instant())),
                    Updates.inc("version", 1L),
                    Updates.set("updatedAt", Date.from(clock.instant())),
                ),
                FindOneAndUpdateOptions()
                    .arrayFilters(listOf(Document("item.id", itemId)))
                    .returnDocument(ReturnDocument.AFTER),
            ) ?: throw ApiException(404, "shopping_item_not_found", "Shopping item not found.")
        val item = updated.getList("items", Document::class.java).orEmpty().first { it.getString("id") == itemId }
        return ShoppingItemUpdate(
            item = itemView(item),
            version = (updated["version"] as? Number)?.toLong() ?: 0,
            updatedAt = (updated["updatedAt"] as Date).toInstant(),
        )
    }

    private fun aggregate(
        principal: TableplanPrincipal,
        planId: String,
        checked: Map<String, Boolean>,
        measurementSystem: String,
    ): List<Document> = metrics.record("shopping.aggregate") {
        val plan =
            plans.getById(principal, planId)
                ?: throw ApiException(404, "plan_not_found", "Meal plan not found.")
        val access = RecipeAccess(principal.userId, principal.householdId)
        val recipeById = recipes.findByIds(plan.items.map { it.recipeId }.distinct(), access)
        val groups = linkedMapOf<String, Aggregate>()
        plan.items.forEach { planned ->
            val recipe = recipeById[planned.recipeId] ?: return@forEach
            val scale = planned.servings / (recipe.servings?.takeIf { it > 0 } ?: planned.servings)
            recipe.recipeIngredients.forEach { ingredient ->
                val rawMin = ingredient.quantityMin?.toBigDecimalOrNull()?.multiply(BigDecimal.valueOf(scale))
                val rawMax = ingredient.quantityMax?.toBigDecimalOrNull()?.multiply(BigDecimal.valueOf(scale))
                val targetUnit =
                    ingredient.unitId?.let { QuantitySupport.preferredUnit(it, measurementSystem) }
                val min =
                    if (rawMin != null && ingredient.unitId != null && targetUnit != null) {
                        QuantitySupport.convert(rawMin, ingredient.unitId, targetUnit)
                    } else {
                        null
                    }
                val max =
                    if (rawMax != null && ingredient.unitId != null && targetUnit != null) {
                        QuantitySupport.convert(rawMax, ingredient.unitId, targetUnit)
                    } else {
                        null
                    }
                val convertible = min != null && targetUnit != null
                val key =
                    if (convertible) {
                        "${ingredient.ingredient.lowercase()}:$targetUnit:${ingredient.preparation?.lowercase().orEmpty()}"
                    } else {
                        "unresolved:${recipe.id}:${ingredient.rawLine}"
                    }
                val source = ShoppingSource(recipe.id, recipe.name, ingredient.rawLine)
                val existing = groups[key]
                if (existing == null) {
                    groups[key] =
                        Aggregate(
                            key,
                            ingredient.ingredient,
                            min,
                            max,
                            targetUnit,
                            !convertible,
                            mutableListOf(source),
                        )
                } else {
                    val previousMin = existing.min
                    val previousMax = existing.max
                    existing.min = add(existing.min, min)
                    if (previousMax != null || max != null) {
                        existing.max = add(previousMax ?: previousMin, max ?: min)
                    }
                    existing.sources += source
                }
            }
        }
        groups.values
            .sortedBy { it.name.lowercase() }
            .map {
                Document("id", UUID.randomUUID().toString())
                    .append("key", it.key)
                    .append("name", it.name)
                    .append("quantityMin", it.min?.stripTrailingZeros()?.toPlainString())
                    .append("quantityMax", it.max?.stripTrailingZeros()?.toPlainString())
                    .append("baseUnitId", it.unitId)
                    .append("checked", checked[it.key] ?: false)
                    .append("unresolved", it.unresolved)
                    .append(
                        "sources",
                        it.sources.map { source ->
                            Document("recipeId", source.recipeId)
                                .append("recipeName", source.recipeName)
                                .append("rawLine", source.rawLine)
                        },
                    )
            }
    }

    private fun view(document: Document, principal: TableplanPrincipal): ShoppingList {
        val plan = plans.getById(principal, document.getString("planId"))
        return ShoppingList(
            id = document.getString("_id"),
            name = document.getString("name"),
            measurementSystem = document.getString("measurementSystem") ?: "original",
            generatedAt = (document["createdAt"] as Date).toInstant(),
            updatedAt = (document["updatedAt"] as Date).toInstant(),
            version = (document["version"] as? Number)?.toLong() ?: 0L,
            plan =
                plan?.let {
                    ShoppingPlan(it.id, it.name, it.startsOn, it.endsOn, it.items.size)
                },
            items =
                document.getList("items", Document::class.java).orEmpty().map(::itemView),
        )
    }

    private fun itemView(item: Document) =
        ShoppingItem(
            id = item.getString("id"),
            name = item.getString("name"),
            quantityMin = item.getString("quantityMin"),
            quantityMax = item.getString("quantityMax"),
            unitId = item.getString("baseUnitId"),
            checked = item.getBoolean("checked", false),
            unresolved = item.getBoolean("unresolved", false),
            sources =
                item.getList("sources", Document::class.java).orEmpty().map {
                    ShoppingSource(
                        it.getString("recipeId"),
                        it.getString("recipeName"),
                        it.getString("rawLine"),
                    )
                },
        )

    private fun requireMeasurement(value: String) {
        if (value !in setOf("original", "us", "metric")) {
            throw ApiException(400, "measurement_invalid", "Measurement system must be original, metric, or US.")
        }
    }

    private fun add(left: BigDecimal?, right: BigDecimal?): BigDecimal? =
        if (left == null) right else if (right == null) left else left + right
}

package com.tableplan.planning

import com.mongodb.MongoWriteException
import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.FindOneAndUpdateOptions
import com.mongodb.client.model.ReturnDocument
import com.mongodb.client.model.UpdateOptions
import com.mongodb.client.model.Updates
import com.tableplan.api.ApiException
import com.tableplan.auth.TableplanPrincipal
import com.tableplan.recipe.RecipeAccess
import com.tableplan.recipe.RecipeService
import org.bson.Document
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDate
import java.util.Date
import java.util.UUID

data class MealPlanItem(
    val id: String,
    val recipeId: String,
    val recipeName: String,
    val plannedDate: String,
    val mealSlot: String,
    val servings: Double,
    val notes: String?,
)

data class MealPlan(
    val id: String,
    val name: String,
    val startsOn: String,
    val endsOn: String,
    val version: Long,
    val items: List<MealPlanItem>,
)

data class MealPlanItemContext(
    val itemId: String,
    val planId: String,
    val planName: String,
    val startsOn: String,
    val endsOn: String,
    val recipeId: String,
    val plannedDate: String,
    val mealSlot: String,
    val servings: Double,
)

@Service
class PlanService(
    private val database: MongoDatabase,
    private val recipes: RecipeService,
    private val membership: MembershipGuard,
    private val clock: Clock,
) {
    private val plans = database.getCollection("meal_plans")

    fun getWeek(principal: TableplanPrincipal, week: String): MealPlan? {
        membership.require(principal)
        val (start, end) = PlanDates.week(week)
        return plans.find(
            Filters.and(
                Filters.eq("householdId", principal.householdId),
                Filters.eq("startsOn", start.toString()),
                Filters.eq("endsOn", end.toString()),
            ),
        ).first()?.let(::view)
    }

    fun getById(principal: TableplanPrincipal, id: String): MealPlan? {
        membership.require(principal)
        return plans.find(
            Filters.and(Filters.eq("_id", id), Filters.eq("householdId", principal.householdId)),
        ).first()?.let(::view)
    }

    fun getItemContext(principal: TableplanPrincipal, itemId: String): MealPlanItemContext? {
        membership.require(principal)
        val document =
            plans.find(
                Filters.and(
                    Filters.eq("householdId", principal.householdId),
                    Filters.eq("items.id", itemId),
                ),
            ).first() ?: return null
        val item =
            document.getList("items", Document::class.java).orEmpty()
                .firstOrNull { it.getString("id") == itemId } ?: return null
        return MealPlanItemContext(
            itemId = itemId,
            planId = document.getString("_id"),
            planName = document.getString("name"),
            startsOn = document.getString("startsOn"),
            endsOn = document.getString("endsOn"),
            recipeId = item.getString("recipeId"),
            plannedDate = item.getString("plannedDate"),
            mealSlot = item.getString("mealSlot"),
            servings = (item["servings"] as Number).toDouble(),
        )
    }

    fun addItem(
        principal: TableplanPrincipal,
        week: String,
        recipeId: String,
        plannedDate: String,
        slot: String,
        servings: Double,
        notes: String?,
    ): MealPlanItem = addItemInternal(principal, week, recipeId, plannedDate, slot, servings, notes).first

    fun addItemToPlan(
        principal: TableplanPrincipal,
        week: String,
        recipeId: String,
        plannedDate: String,
        slot: String,
        servings: Double,
        notes: String?,
    ): MealPlan = addItemInternal(principal, week, recipeId, plannedDate, slot, servings, notes).second

    private fun addItemInternal(
        principal: TableplanPrincipal,
        week: String,
        recipeId: String,
        plannedDate: String,
        slot: String,
        servings: Double,
        notes: String?,
    ): Pair<MealPlanItem, MealPlan> {
        membership.require(principal)
        if (servings !in 0.25..100.0 || !servings.isFinite()) {
            throw ApiException(400, "servings_invalid", "Servings must be between 0.25 and 100.")
        }
        if (!slot.matches(Regex("^[a-z0-9][a-z0-9_-]{0,63}$"))) {
            throw ApiException(400, "meal_slot_invalid", "Meal section is invalid.")
        }
        if ((notes?.length ?: 0) > 1_000) throw ApiException(400, "notes_too_long", "Notes are too long.")
        val recipe =
            recipes.findById(recipeId, RecipeAccess(principal.userId, principal.householdId))
                ?: throw ApiException(404, "recipe_not_found", "Recipe not found.")
        if (recipe.visibility == "user_private") {
            throw ApiException(409, "recipe_not_shared_with_household", "Private recipes cannot be added to a household plan.")
        }
        val (start, end) = PlanDates.week(week)
        PlanDates.requireInWeek(plannedDate, start, end)
        val planId = ensure(principal, start, end)
        val item =
            MealPlanItem(
                id = UUID.randomUUID().toString(),
                recipeId = recipeId,
                recipeName = recipe.name,
                plannedDate = plannedDate,
                mealSlot = slot,
                servings = servings,
                notes = notes?.trim()?.takeIf(String::isNotEmpty),
            )
        val itemDocument = item.toDocument().append("createdAt", Date.from(clock.instant()))
        val updated =
            plans.findOneAndUpdate(
                Filters.and(Filters.eq("_id", planId), Filters.eq("householdId", principal.householdId)),
                Updates.combine(
                    Updates.push("items", itemDocument),
                    Updates.inc("version", 1L),
                    Updates.set("updatedAt", Date.from(clock.instant())),
                ),
                FindOneAndUpdateOptions().returnDocument(ReturnDocument.AFTER),
            ) ?: throw ApiException(409, "plan_conflict", "Meal plan changed. Refresh and retry.")
        return item to view(updated)
    }

    fun removeItem(principal: TableplanPrincipal, itemId: String): MealPlan {
        membership.require(principal)
        val updated =
            plans.findOneAndUpdate(
                Filters.and(
                    Filters.eq("householdId", principal.householdId),
                    Filters.eq("items.id", itemId),
                ),
                Updates.combine(
                    Updates.pull("items", Document("id", itemId)),
                    Updates.inc("version", 1L),
                    Updates.set("updatedAt", Date.from(clock.instant())),
                ),
                FindOneAndUpdateOptions().returnDocument(ReturnDocument.AFTER),
            ) ?: throw ApiException(404, "plan_item_not_found", "Meal-plan item was not found.")
        return view(updated)
    }

    fun updateServings(principal: TableplanPrincipal, itemId: String, servings: Double): MealPlan {
        membership.require(principal)
        if (servings !in 0.25..100.0 || !servings.isFinite()) {
            throw ApiException(400, "servings_invalid", "Servings must be between 0.25 and 100.")
        }
        val updated =
            plans.findOneAndUpdate(
                Filters.and(
                    Filters.eq("householdId", principal.householdId),
                    Filters.eq("items.id", itemId),
                ),
                Updates.combine(
                    Updates.set("items.$[item].servings", servings),
                    Updates.set("items.$[item].updatedAt", Date.from(clock.instant())),
                    Updates.inc("version", 1L),
                    Updates.set("updatedAt", Date.from(clock.instant())),
                ),
                FindOneAndUpdateOptions()
                    .arrayFilters(listOf(Document("item.id", itemId)))
                    .returnDocument(ReturnDocument.AFTER),
            ) ?: throw ApiException(404, "plan_item_not_found", "Meal-plan item was not found.")
        return view(updated)
    }

    fun clonePrevious(principal: TableplanPrincipal, targetWeek: String): MealPlan {
        membership.require(principal)
        val targetStart = PlanDates.startOfWeek(targetWeek)
        val sourceStart = targetStart.minusWeeks(1)
        val source =
            plans.find(
                Filters.and(
                    Filters.eq("householdId", principal.householdId),
                    Filters.eq("startsOn", sourceStart.toString()),
                    Filters.eq("endsOn", sourceStart.plusDays(6).toString()),
                ),
            ).first() ?: throw ApiException(409, "source_empty", "The previous week has no meals to copy.")
        val sourceItems = source.getList("items", Document::class.java).orEmpty()
        if (sourceItems.isEmpty()) throw ApiException(409, "source_empty", "The previous week has no meals to copy.")
        val targetId = ensure(principal, targetStart, targetStart.plusDays(6))
        val offset = java.time.temporal.ChronoUnit.DAYS.between(sourceStart, targetStart)
        val copied =
            sourceItems.map { item ->
                Document(item)
                    .append("id", UUID.randomUUID().toString())
                    .append("plannedDate", LocalDate.parse(item.getString("plannedDate")).plusDays(offset).toString())
                    .append("createdAt", Date.from(clock.instant()))
            }
        val result =
            plans.updateOne(
                Filters.and(
                    Filters.eq("_id", targetId),
                    Filters.eq("householdId", principal.householdId),
                    Filters.size("items", 0),
                ),
                Updates.combine(
                    Updates.set("items", copied),
                    Updates.inc("version", 1L),
                    Updates.set("updatedAt", Date.from(clock.instant())),
                ),
            )
        if (result.modifiedCount != 1L) {
            throw ApiException(409, "target_not_empty", "The target week already contains meals.")
        }
        return getById(principal, targetId)!!
    }

    private fun ensure(principal: TableplanPrincipal, start: LocalDate, end: LocalDate): String {
        val proposed = UUID.randomUUID().toString()
        val now = Date.from(clock.instant())
        try {
            plans.updateOne(
                Filters.and(
                    Filters.eq("householdId", principal.householdId),
                    Filters.eq("startsOn", start.toString()),
                    Filters.eq("endsOn", end.toString()),
                ),
                Updates.combine(
                    Updates.setOnInsert("_id", proposed),
                    Updates.setOnInsert("householdId", principal.householdId),
                    Updates.setOnInsert("name", "Week of $start"),
                    Updates.setOnInsert("startsOn", start.toString()),
                    Updates.setOnInsert("endsOn", end.toString()),
                    Updates.setOnInsert("timezone", "UTC"),
                    Updates.setOnInsert("createdByUserId", principal.userId),
                    Updates.setOnInsert("items", emptyList<Document>()),
                    Updates.setOnInsert("version", 0L),
                    Updates.setOnInsert("createdAt", now),
                    Updates.set("updatedAt", now),
                ),
                UpdateOptions().upsert(true),
            )
        } catch (_: MongoWriteException) {
            // A concurrent request won the unique household/week upsert.
        }
        return plans.find(
            Filters.and(
                Filters.eq("householdId", principal.householdId),
                Filters.eq("startsOn", start.toString()),
                Filters.eq("endsOn", end.toString()),
            ),
        ).projection(Document("_id", 1)).first()?.getString("_id")
            ?: throw ApiException(503, "plan_create_failed", "Meal plan could not be created.")
    }

    private fun view(document: Document) =
        MealPlan(
            id = document.getString("_id"),
            name = document.getString("name"),
            startsOn = document.getString("startsOn"),
            endsOn = document.getString("endsOn"),
            version = (document["version"] as? Number)?.toLong() ?: 0,
            items =
                document.getList("items", Document::class.java).orEmpty().map {
                    MealPlanItem(
                        id = it.getString("id"),
                        recipeId = it.getString("recipeId"),
                        recipeName = it.getString("recipeName") ?: "Recipe",
                        plannedDate = it.getString("plannedDate"),
                        mealSlot = it.getString("mealSlot"),
                        servings = (it["servings"] as Number).toDouble(),
                        notes = it.getString("notes"),
                    )
                },
        )

    private fun MealPlanItem.toDocument() =
        Document("id", id)
            .append("recipeId", recipeId)
            .append("recipeName", recipeName)
            .append("plannedDate", plannedDate)
            .append("mealSlot", mealSlot)
            .append("servings", servings)
            .append("notes", notes)
}

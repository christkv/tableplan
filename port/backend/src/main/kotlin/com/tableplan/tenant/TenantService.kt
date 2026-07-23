package com.tableplan.tenant

import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.ReplaceOptions
import com.mongodb.client.model.Updates
import com.tableplan.api.ApiException
import com.tableplan.auth.TableplanPrincipal
import com.tableplan.recipe.RecipeAccess
import com.tableplan.recipe.RecipeSearch
import com.tableplan.recipe.RecipeSearchNormalizer
import com.tableplan.recipe.RecipeService
import com.tableplan.recipe.RecipeSummary
import org.bson.Document
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Instant
import java.util.Date
import java.util.UUID

data class MealSlot(val id: String, val label: String)

data class PreferencesView(
    val measurementSystem: String,
    val mealSlots: List<MealSlot>,
)

data class SavedSearch(
    val id: String,
    val name: String,
    val query: String,
    val ingredient: String,
    val tags: List<String>,
    val tagMatch: String,
    val scope: String,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class HouseholdView(
    val id: String,
    val name: String,
    val timezone: String,
    val currentRole: String,
    val members: List<HouseholdMember>,
)

data class HouseholdMember(
    val userId: String,
    val name: String,
    val email: String,
    val role: String,
    val relationship: String,
)

data class HouseholdChoice(
    val id: String,
    val name: String,
    val role: String,
    val active: Boolean,
)

@Service
class TenantService(
    private val database: MongoDatabase,
    private val recipes: RecipeService,
    private val clock: Clock,
) {
    private val memberships = database.getCollection("household_memberships")
    private val favourites = database.getCollection("favourites")
    private val profiles = database.getCollection("user_profiles")
    private val households = database.getCollection("households")
    private val savedSearches = database.getCollection("saved_recipe_searches")

    fun setFavourite(principal: TableplanPrincipal, recipeId: String, favourite: Boolean) {
        requireMembership(principal)
        val access = RecipeAccess(principal.userId, principal.householdId)
        if (favourite) {
            if (recipes.findById(recipeId, access) == null) {
                throw ApiException(404, "recipe_not_found", "Recipe not found")
            }
            favourites.updateOne(
                Filters.and(Filters.eq("userId", principal.userId), Filters.eq("recipeId", recipeId)),
                Updates.combine(
                    Updates.setOnInsert("_id", UUID.randomUUID().toString()),
                    Updates.setOnInsert("userId", principal.userId),
                    Updates.setOnInsert("recipeId", recipeId),
                    Updates.setOnInsert("createdAt", Date.from(clock.instant())),
                ),
                com.mongodb.client.model.UpdateOptions().upsert(true),
            )
        } else {
            favourites.deleteOne(
                Filters.and(Filters.eq("userId", principal.userId), Filters.eq("recipeId", recipeId)),
            )
        }
    }

    fun listFavourites(principal: TableplanPrincipal): List<RecipeSummary> {
        requireMembership(principal)
        val access = RecipeAccess(principal.userId, principal.householdId)
        val ids = favourites.find(Filters.eq("userId", principal.userId))
            .sort(Document("createdAt", -1))
            .limit(500)
            .map { it.getString("recipeId") }
            .toList()
        val summaries = recipes.findSummariesByIds(ids, access)
        return ids.mapNotNull(summaries::get)
    }

    fun isFavourite(principal: TableplanPrincipal, recipeId: String): Boolean {
        requireMembership(principal)
        return favourites.find(
            Filters.and(Filters.eq("userId", principal.userId), Filters.eq("recipeId", recipeId)),
        ).projection(Document("_id", 1)).first() != null
    }

    fun preferences(principal: TableplanPrincipal): PreferencesView {
        requireMembership(principal)
        val profile = profiles.find(Filters.eq("_id", principal.userId)).first()
        val household = households.find(Filters.eq("_id", principal.householdId)).first()
        val preferences = household?.get("preferences") as? Document
        val measurement =
            profile?.getString("preferredMeasurementSystem")
                ?: preferences?.getString("measurementSystem")
                ?: "original"
        val slots =
            (preferences?.get("mealSlots") as? List<*>)
                ?.mapNotNull { it as? Document }
                ?.map { MealSlot(it.getString("id"), it.getString("label")) }
                ?.takeIf(List<MealSlot>::isNotEmpty)
                ?: defaultSlots
        return PreferencesView(measurement, slots)
    }

    fun updateMeasurement(principal: TableplanPrincipal, value: String): PreferencesView {
        requireMembership(principal)
        if (value !in setOf("original", "us", "metric")) {
            throw ApiException(400, "measurement_invalid", "Measurement system must be original, metric, or US.")
        }
        val now = Date.from(clock.instant())
        profiles.updateOne(
            Filters.eq("_id", principal.userId),
            Updates.combine(
                Updates.set("userId", principal.userId),
                Updates.set("preferredMeasurementSystem", value),
                Updates.set("updatedAt", now),
            ),
            com.mongodb.client.model.UpdateOptions().upsert(true),
        )
        households.updateOne(
            Filters.eq("_id", principal.householdId),
            Updates.combine(
                Updates.set("preferences.measurementSystem", value),
                Updates.set("updatedAt", now),
            ),
        )
        return preferences(principal)
    }

    fun updateSlots(principal: TableplanPrincipal, input: List<MealSlot>): PreferencesView {
        requireMembership(principal)
        val slots = normalizeSlots(input)
        households.updateOne(
            Filters.eq("_id", principal.householdId),
            Updates.combine(
                Updates.set("preferences.mealSlots", slots.map { Document("id", it.id).append("label", it.label) }),
                Updates.set("updatedAt", Date.from(clock.instant())),
            ),
        )
        return preferences(principal)
    }

    fun listSavedSearches(principal: TableplanPrincipal): List<SavedSearch> {
        requireMembership(principal)
        return savedSearches.find(Filters.eq("householdId", principal.householdId))
            .sort(Document("updatedAt", -1).append("name", 1))
            .limit(200)
            .map(::savedSearch)
            .toList()
    }

    fun saveSearch(
        principal: TableplanPrincipal,
        nameInput: String,
        query: String?,
        ingredient: String?,
        tags: List<String>,
        tagMatch: String?,
        scope: String?,
    ): SavedSearch {
        requireMembership(principal)
        val name = nameInput.trim().replace(Regex("\\s+"), " ")
        if (name.isBlank() || name.length > 80) {
            throw ApiException(400, "saved_search_name_invalid", "Saved search name is invalid.")
        }
        val normalized = RecipeSearchNormalizer.normalize(query, ingredient, tags, tagMatch, scope, null, null)
        val now = Date.from(clock.instant())
        savedSearches.updateOne(
            Filters.and(Filters.eq("householdId", principal.householdId), Filters.eq("name", name)),
            Updates.combine(
                Updates.set("query", normalized.query),
                Updates.set("ingredient", normalized.ingredient),
                Updates.set("tags", normalized.tags),
                Updates.set("tagMatch", normalized.tagMatch.name.lowercase()),
                Updates.set("scope", normalized.scope.name.lowercase()),
                Updates.set("createdByUserId", principal.userId),
                Updates.set("updatedAt", now),
                Updates.setOnInsert("_id", UUID.randomUUID().toString()),
                Updates.setOnInsert("householdId", principal.householdId),
                Updates.setOnInsert("createdAt", now),
            ),
            com.mongodb.client.model.UpdateOptions().upsert(true),
        )
        return savedSearches.find(
            Filters.and(Filters.eq("householdId", principal.householdId), Filters.eq("name", name)),
        ).first()?.let(::savedSearch) ?: throw ApiException(500, "saved_search_failed", "Saved search could not be created.")
    }

    fun deleteSavedSearch(principal: TableplanPrincipal, id: String) {
        requireMembership(principal)
        savedSearches.deleteOne(
            Filters.and(Filters.eq("_id", id), Filters.eq("householdId", principal.householdId)),
        )
    }

    fun household(principal: TableplanPrincipal): HouseholdView {
        val current = requireMembership(principal)
        val household =
            households.find(Filters.eq("_id", principal.householdId)).first()
                ?: throw ApiException(404, "household_not_found", "Household not found.")
        val memberDocuments = memberships.find(Filters.eq("householdId", principal.householdId)).toList()
        val userIds = memberDocuments.map { it.getString("userId") }
        val users =
            database.getCollection("users")
                .find(Filters.`in`("_id", userIds))
                .associateBy { it.getString("_id") }
        return HouseholdView(
            id = principal.householdId,
            name = household.getString("name"),
            timezone = household.getString("timezone") ?: "UTC",
            currentRole = current.getString("role"),
            members =
                memberDocuments.map { member ->
                    val user = users[member.getString("userId")]
                    HouseholdMember(
                        userId = member.getString("userId"),
                        name = user?.getString("name").orEmpty(),
                        email = user?.getString("email").orEmpty(),
                        role = member.getString("role"),
                        relationship = member.getString("relationship") ?: "other",
                    )
                },
        )
    }

    fun availableHouseholds(principal: TableplanPrincipal): List<HouseholdChoice> {
        val memberDocuments = memberships.find(Filters.eq("userId", principal.userId)).toList()
        val householdDocuments =
            households.find(Filters.`in`("_id", memberDocuments.map { it.getString("householdId") }))
                .associateBy { it.getString("_id") }
        return memberDocuments.mapNotNull { member ->
            val id = member.getString("householdId")
            val household = householdDocuments[id] ?: return@mapNotNull null
            HouseholdChoice(id, household.getString("name"), member.getString("role"), id == principal.householdId)
        }.sortedWith(compareByDescending<HouseholdChoice> { it.active }.thenBy { it.name.lowercase() })
    }

    private fun requireMembership(principal: TableplanPrincipal): Document =
        memberships.find(
            Filters.and(
                Filters.eq("userId", principal.userId),
                Filters.eq("householdId", principal.householdId),
            ),
        ).first() ?: throw ApiException(403, "household_access_denied", "Household access denied.")

    private fun normalizeSlots(values: List<MealSlot>): List<MealSlot> {
        if (values.isEmpty() || values.size > 8) {
            throw ApiException(400, "meal_slots_invalid", "One to eight meal sections are required.")
        }
        val result =
            values.mapIndexed { index, value ->
                val label = value.label.trim().replace(Regex("\\s+"), " ")
                if (label.isBlank() || label.length > 32) {
                    throw ApiException(400, "meal_slot_label_invalid", "Meal section name is invalid.")
                }
                val id =
                    value.id.takeIf { it.matches(Regex("^[a-z0-9][a-z0-9_-]{0,63}$")) }
                        ?: label.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(48)
                            .ifBlank { "meal-${index + 1}" }
                MealSlot(id, label)
            }
        if (result.map { it.id }.distinct().size != result.size || result.map { it.label.lowercase() }.distinct().size != result.size) {
            throw ApiException(400, "meal_slots_duplicate", "Meal section names and identifiers must be unique.")
        }
        return result
    }

    private fun savedSearch(document: Document) =
        SavedSearch(
            id = document.getString("_id"),
            name = document.getString("name"),
            query = document.getString("query").orEmpty(),
            ingredient = document.getString("ingredient").orEmpty(),
            tags = document.getList("tags", String::class.java).orEmpty(),
            tagMatch = if (document.getString("tagMatch") == "any") "any" else "all",
            scope = document.getString("scope") ?: "all",
            createdAt = (document["createdAt"] as Date).toInstant(),
            updatedAt = (document["updatedAt"] as Date).toInstant(),
        )

    private fun com.tableplan.recipe.RecipeDetail.toSummary() =
        RecipeSummary(
            id,
            sourceId,
            name,
            description,
            servings,
            tags,
            ingredients,
            qualityFlags,
            visibility,
            origin,
            isOwner,
        )

    companion object {
        val defaultSlots =
            listOf(
                MealSlot("breakfast", "Breakfast"),
                MealSlot("lunch", "Lunch"),
                MealSlot("dinner", "Dinner"),
                MealSlot("snack", "Snack"),
            )
    }
}

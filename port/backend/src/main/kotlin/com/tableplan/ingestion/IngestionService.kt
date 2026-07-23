package com.tableplan.ingestion

import com.mongodb.client.MongoClient
import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.FindOneAndUpdateOptions
import com.mongodb.client.model.ReturnDocument
import com.mongodb.client.model.Updates
import com.tableplan.api.ApiException
import com.tableplan.artifacts.ArtifactStore
import com.tableplan.auth.TableplanPrincipal
import com.tableplan.config.PerformanceMetrics
import com.tableplan.jobs.JobService
import com.tableplan.planning.MembershipGuard
import org.bson.Document
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Instant
import java.util.Date
import java.util.UUID

data class IngestionView(
    val id: String,
    val status: String,
    val message: String,
    val filename: String?,
    val mediaType: String,
    val draft: RecipeDraft?,
    val ingredientReviews: List<IngredientReviewView>,
    val recipeId: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class IngredientCandidateView(
    val id: String,
    val name: String,
    val category: String?,
)

data class IngredientReviewView(
    val position: Int,
    val rawLine: String,
    val parsedName: String,
    val ingredientId: String?,
    val mappingStatus: String,
    val mappingConfidence: Double,
    val candidates: List<IngredientCandidateView>,
)

data class IngredientSelection(
    val position: Int,
    val ingredientId: String?,
    val rememberAlias: Boolean = false,
)

@Service
class IngestionService(
    private val client: MongoClient,
    private val database: MongoDatabase,
    private val artifacts: ArtifactStore,
    private val jobs: JobService,
    private val membership: MembershipGuard,
    private val clock: Clock,
    private val metrics: PerformanceMetrics,
) {
    private val ingestions = database.getCollection("recipe_ingestions")
    private val recipes = database.getCollection("recipes")
    private val ingredients = database.getCollection("ingredients")
    private val aliases = database.getCollection("ingredient_aliases")

    fun create(
        principal: TableplanPrincipal,
        bytes: ByteArray,
        filename: String?,
        mediaType: String,
        origin: String,
    ): IngestionView {
        membership.require(principal)
        if (bytes.isEmpty()) throw ApiException(400, "source_empty", "Recipe source is empty.")
        if (mediaType !in setOf("text/plain", "text/markdown")) {
            throw ApiException(415, "media_type_unsupported", "This implementation currently accepts text or Markdown.")
        }
        val id = UUID.randomUUID().toString()
        val artifactKey =
            "households/${principal.householdId}/users/${principal.userId}/recipe-ingestions/$id/source"
        runCatching { artifacts.put(artifactKey, bytes) }.getOrElse {
            throw ApiException(413, "artifact_rejected", "Recipe source could not be stored.")
        }
        val now = Date.from(clock.instant())
        ingestions.insertOne(
            Document("_id", id)
                .append("householdId", principal.householdId)
                .append("userId", principal.userId)
                .append("inputKind", "text")
                .append("origin", origin)
                .append("filename", filename?.take(240))
                .append("mediaType", mediaType)
                .append(
                    "sourceArtifact",
                    Document("key", artifactKey)
                        .append("filename", filename?.take(240))
                        .append("mediaType", mediaType)
                        .append("byteSize", bytes.size),
                )
                .append("status", "queued")
                .append("message", "Recipe extraction queued.")
                .append("draft", null)
                .append("createdAt", now)
                .append("updatedAt", now),
        )
        jobs.publish(
            RecipeExtractionJobHandler.TYPE,
            Document("ingestionId", id),
            idempotencyKey = "recipe-extraction:$id",
        )
        return get(principal, id)!!
    }

    fun get(principal: TableplanPrincipal, id: String): IngestionView? {
        membership.require(principal)
        return ingestions.find(
            Filters.and(
                Filters.eq("_id", id),
                Filters.eq("householdId", principal.householdId),
                Filters.eq("userId", principal.userId),
            ),
        ).first()?.let(::view)
    }

    fun publish(
        principal: TableplanPrincipal,
        id: String,
        visibility: String,
        reviewedDraft: RecipeDraft?,
        ingredientSelections: List<IngredientSelection>,
    ): String {
        membership.require(principal)
        if (visibility !in setOf("user_private", "household")) {
            throw ApiException(400, "recipe_visibility_invalid", "Recipe visibility is invalid.")
        }
        val existing =
            ingestions.find(
                Filters.and(
                    Filters.eq("_id", id),
                    Filters.eq("householdId", principal.householdId),
                    Filters.eq("userId", principal.userId),
                ),
            ).first()
        if (existing?.getString("status") == "published") {
            return existing.getString("recipeId")
                ?: throw ApiException(409, "publish_incomplete", "Published ingestion has no recipe.")
        }
        val draft =
            (reviewedDraft ?: existing?.draft()
                ?: throw ApiException(409, "draft_not_ready", "Recipe draft is not ready.")).validated()
        val selections = validateSelections(draft, ingredientSelections)
        val embeddedIngredients = recipeIngredients(principal, draft, selections)
        var resultRecipeId: String? = null
        client.startSession().use { session ->
            session.withTransaction {
                val ingestion =
                    ingestions.findOneAndUpdate(
                        session,
                        Filters.and(
                            Filters.eq("_id", id),
                            Filters.eq("householdId", principal.householdId),
                            Filters.eq("userId", principal.userId),
                            Filters.eq("status", "review_ready"),
                        ),
                        Updates.combine(
                            Updates.set("status", "publishing"),
                            Updates.set("message", "Publishing recipe."),
                            Updates.set("updatedAt", Date.from(clock.instant())),
                        ),
                        FindOneAndUpdateOptions().returnDocument(ReturnDocument.BEFORE),
                    ) ?: throw ApiException(409, "draft_not_ready", "Recipe draft is not ready.")
                val recipeId = UUID.randomUUID().toString()
                val now = Date.from(clock.instant())
                recipes.insertOne(
                    session,
                    Document("_id", recipeId)
                        .append("sourceId", "private:$recipeId")
                        .append("name", draft.title)
                        .append("description", draft.description)
                        .append("servings", draft.servings)
                        .append("servingSize", draft.servingSize)
                        .append("qualityFlags", draft.warnings)
                        .append("tags", draft.tags)
                        .append("visibility", visibility)
                        .append("origin", ingestion.getString("origin") ?: "manual")
                        .append("ownerUserId", principal.userId)
                        .append("ownerHouseholdId", principal.householdId)
                        .append("status", "active")
                        .append(
                            "recipeIngredients",
                            embeddedIngredients,
                        )
                        .append(
                            "steps",
                            draft.steps.mapIndexed { index, step ->
                                Document("position", index).append("instruction", step).append("parseStatus", "parsed")
                            },
                        )
                        .append("createdAt", now)
                        .append("updatedAt", now),
                )
                database.getCollection("recipe_mutation_events").insertOne(
                    session,
                    Document("_id", UUID.randomUUID().toString())
                        .append("recipeId", recipeId)
                        .append("householdId", principal.householdId)
                        .append("userId", principal.userId)
                        .append("type", "published")
                        .append("idempotencyKey", "publish:$id")
                        .append("createdAt", now),
                )
                embeddedIngredients.forEach { ingredient ->
                    val selection = selections[ingredient.getInteger("position")] ?: return@forEach
                    if (!selection.rememberAlias || selection.ingredientId == null) return@forEach
                    aliases.updateOne(
                        session,
                        Filters.and(
                            Filters.eq("householdId", principal.householdId),
                            Filters.eq(
                                "normalizedAlias",
                                PrivateIngredientParser.normalize(ingredient.getString("ingredient")),
                            ),
                        ),
                        Updates.combine(
                            Updates.setOnInsert("_id", UUID.randomUUID().toString()),
                            Updates.setOnInsert("householdId", principal.householdId),
                            Updates.setOnInsert("normalizedAlias", PrivateIngredientParser.normalize(ingredient.getString("ingredient"))),
                            Updates.setOnInsert("createdByUserId", principal.userId),
                            Updates.setOnInsert("createdAt", now),
                            Updates.set("ingredientId", selection.ingredientId),
                            Updates.set("updatedAt", now),
                        ),
                        com.mongodb.client.model.UpdateOptions().upsert(true),
                    )
                }
                ingestions.updateOne(
                    session,
                    Filters.eq("_id", id),
                    Updates.combine(
                        Updates.set("status", "published"),
                        Updates.set("message", "Recipe published."),
                        Updates.set("recipeId", recipeId),
                        Updates.set("draft", draft.toDocument()),
                        Updates.set("updatedAt", now),
                    ),
                )
                resultRecipeId = recipeId
            }
        }
        return resultRecipeId ?: throw ApiException(503, "publish_failed", "Recipe could not be published.")
    }

    fun updateOwnedRecipe(
        principal: TableplanPrincipal,
        recipeId: String,
        draft: RecipeDraft,
        visibility: String,
    ) {
        membership.require(principal)
        if (visibility !in setOf("user_private", "household")) {
            throw ApiException(400, "recipe_visibility_invalid", "Recipe visibility is invalid.")
        }
        val value = draft.validated()
        val embeddedIngredients = recipeIngredients(principal, value, emptyMap())
        val result =
            recipes.updateOne(
                Filters.and(
                    Filters.eq("_id", recipeId),
                    Filters.eq("ownerUserId", principal.userId),
                    Filters.eq("ownerHouseholdId", principal.householdId),
                ),
                Updates.combine(
                    Updates.set("name", value.title),
                    Updates.set("description", value.description),
                    Updates.set("servings", value.servings),
                    Updates.set("servingSize", value.servingSize),
                    Updates.set("tags", value.tags),
                    Updates.set(
                        "recipeIngredients",
                        embeddedIngredients,
                    ),
                    Updates.set(
                        "steps",
                        value.steps.mapIndexed { index, step ->
                            Document("position", index)
                                .append("instruction", step)
                                .append("parseStatus", "parsed")
                        },
                    ),
                    Updates.set("qualityFlags", value.warnings),
                    Updates.set("visibility", visibility),
                    Updates.set("updatedAt", Date.from(clock.instant())),
                ),
            )
        if (result.matchedCount != 1L) throw ApiException(404, "recipe_not_found", "Recipe not found.")
    }

    internal fun loadForExtraction(id: String): Pair<Document, ByteArray> {
        val ingestion = ingestions.find(Filters.eq("_id", id)).first() ?: error("ingestion_not_found")
        val artifact = ingestion.get("sourceArtifact", Document::class.java)
        return ingestion to artifacts.get(artifact.getString("key"))
    }

    internal fun saveExtracted(id: String, draft: RecipeDraft) {
        ingestions.updateOne(
            Filters.and(Filters.eq("_id", id), Filters.`in`("status", listOf("queued", "extracting"))),
            Updates.combine(
                Updates.set("status", "review_ready"),
                Updates.set("message", "Recipe draft is ready for review."),
                Updates.set("draft", draft.toDocument()),
                Updates.set("updatedAt", Date.from(clock.instant())),
            ),
        )
    }

    private fun view(document: Document) =
        IngestionView(
            id = document.getString("_id"),
            status = document.getString("status"),
            message = document.getString("message").orEmpty(),
            filename = document.getString("filename"),
            mediaType = document.getString("mediaType"),
            draft = (document["draft"] as? Document)?.toDraft(),
            ingredientReviews = reviews(document),
            recipeId = document.getString("recipeId"),
            createdAt = (document["createdAt"] as Date).toInstant(),
            updatedAt = (document["updatedAt"] as Date).toInstant(),
        )

    private fun reviews(document: Document): List<IngredientReviewView> =
        metrics.record("ingestion.ingredient-review") {
            val draft = (document["draft"] as? Document)?.toDraft() ?: return@record emptyList()
            val householdId = document.getString("householdId")
            val parsedLines = draft.ingredients.map(PrivateIngredientParser::parse)
            val lookup = ingredientLookup(householdId, parsedLines.map { it.normalizedIngredient })
            draft.ingredients.mapIndexed { position, rawLine ->
                val parsed = parsedLines[position]
                val mapped = lookup.mapped[parsed.normalizedIngredient]
                IngredientReviewView(
                    position = position,
                    rawLine = rawLine,
                    parsedName = parsed.ingredient,
                    ingredientId = mapped?.first,
                    mappingStatus = if (mapped == null) "unmapped" else "mapped",
                    mappingConfidence = mapped?.second ?: 0.0,
                    candidates = lookup.candidates[parsed.normalizedIngredient].orEmpty(),
                )
            }
        }

    private fun validateSelections(
        draft: RecipeDraft,
        selections: List<IngredientSelection>,
    ): Map<Int, IngredientSelection> {
        if (selections.size > 250 || selections.any { it.position !in draft.ingredients.indices }) {
            throw ApiException(400, "ingredient_selection_invalid", "Ingredient selection is invalid.")
        }
        val byPosition = selections.associateBy(IngredientSelection::position)
        if (byPosition.size != selections.size) {
            throw ApiException(400, "ingredient_selection_invalid", "Ingredient positions must be unique.")
        }
        val selectedIds = byPosition.values.mapNotNull(IngredientSelection::ingredientId).distinct()
        val existingIds =
            if (selectedIds.isEmpty()) emptySet() else {
                ingredients.find(Filters.`in`("_id", selectedIds))
                    .projection(Document("_id", 1))
                    .map { it.getString("_id") }
                    .toSet()
            }
        if (existingIds.size != selectedIds.size) {
            throw ApiException(400, "ingredient_selection_invalid", "Selected ingredient does not exist.")
        }
        return byPosition
    }

    private fun recipeIngredients(
        principal: TableplanPrincipal,
        draft: RecipeDraft,
        selections: Map<Int, IngredientSelection>,
    ): List<Document> {
        val parsedLines = draft.ingredients.map(PrivateIngredientParser::parse)
        val lookup = ingredientLookup(principal.householdId, parsedLines.map { it.normalizedIngredient })
        return draft.ingredients.mapIndexed { position, rawLine ->
            val parsed = parsedLines[position]
            val selected =
                if (selections.containsKey(position)) {
                    selections[position]?.ingredientId
                } else {
                    lookup.mapped[parsed.normalizedIngredient]?.first
                }
            Document("id", UUID.randomUUID().toString())
                .append("position", position)
                .append("rawLine", rawLine)
                .append("ingredient", parsed.ingredient)
                .append("canonicalIngredientId", selected)
                .append("quantityMin", parsed.quantityMin)
                .append("quantityMax", parsed.quantityMax)
                .append("unitId", parsed.unitId)
                .append("preparation", parsed.preparation)
                .append(
                    "parseStatus",
                    if (selected != null && parsed.parseStatus == "unresolved") "partial" else parsed.parseStatus,
                )
                .append("parseConfidence", if (selected == null) 0.0 else 0.9)
        }
    }

    private data class IngredientLookup(
        val mapped: Map<String, Pair<String, Double>>,
        val candidates: Map<String, List<IngredientCandidateView>>,
    )

    private fun ingredientLookup(householdId: String, names: List<String>): IngredientLookup {
        val normalized = names.filter(String::isNotBlank).distinct()
        if (normalized.isEmpty()) return IngredientLookup(emptyMap(), emptyMap())
        val mapped = mutableMapOf<String, Pair<String, Double>>()
        aliases.find(
            Filters.and(
                Filters.`in`("normalizedAlias", normalized),
                Filters.or(Filters.eq("householdId", householdId), Filters.eq("householdId", null)),
            ),
        ).sort(Document("householdId", 1)).forEach { alias ->
            val local = alias.getString("householdId") == householdId
            mapped[alias.getString("normalizedAlias")] = alias.getString("ingredientId") to if (local) 1.0 else .98
        }
        val candidateFilter =
            Filters.or(normalized.map { Filters.regex("normalizedName", "^${Regex.escape(it)}", "i") })
        val rows =
            ingredients.find(candidateFilter)
                .projection(Document("_id", 1).append("normalizedName", 1).append("canonicalName", 1).append("groceryCategory", 1))
                .sort(Document("normalizedName", 1))
                .limit((normalized.size * 8).coerceAtMost(2_000))
                .toList()
        rows.forEach { ingredient ->
            val exact = ingredient.getString("normalizedName")
            if (exact in normalized && exact !in mapped) mapped[exact] = ingredient.getString("_id") to .98
        }
        val candidates =
            normalized.associateWith { name ->
                rows.asSequence()
                    .filter { it.getString("normalizedName").startsWith(name, ignoreCase = true) }
                    .take(8)
                    .map {
                        IngredientCandidateView(
                            id = it.getString("_id"),
                            name = it.getString("canonicalName"),
                            category = it.getString("groceryCategory"),
                        )
                    }.toList()
            }
        return IngredientLookup(mapped, candidates)
    }

    private fun Document.draft(): RecipeDraft =
        (get("draft", Document::class.java) ?: throw ApiException(409, "draft_not_ready", "Recipe draft is not ready."))
            .toDraft()

    private fun Document.toDraft() =
        RecipeDraft(
            title = getString("title"),
            description = getString("description").orEmpty(),
            servings = (get("servings") as? Number)?.toDouble(),
            servingSize = getString("servingSize"),
            ingredients = getList("ingredients", String::class.java).orEmpty(),
            steps = getList("steps", String::class.java).orEmpty(),
            tags = getList("tags", String::class.java).orEmpty(),
            warnings = getList("warnings", String::class.java).orEmpty(),
        )

    private fun RecipeDraft.toDocument() =
        Document("title", title)
            .append("description", description)
            .append("servings", servings)
            .append("servingSize", servingSize)
            .append("ingredients", ingredients)
            .append("steps", steps)
            .append("tags", tags)
            .append("warnings", warnings)
}

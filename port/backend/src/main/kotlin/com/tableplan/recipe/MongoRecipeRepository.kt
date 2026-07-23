package com.tableplan.recipe

import com.mongodb.client.MongoCollection
import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.Sorts
import org.bson.Document
import org.bson.conversions.Bson
import org.springframework.stereotype.Repository
import java.nio.charset.StandardCharsets
import java.util.Base64

@Repository
class MongoRecipeRepository(
    database: MongoDatabase,
) : RecipeRepository {
    private val recipes: MongoCollection<Document> = database.getCollection("recipes")
    private val tags: MongoCollection<Document> = database.getCollection("tags")

    override fun search(search: RecipeSearch, access: RecipeAccess): RecipeSearchResult {
        val atlasSearch = search.query.isNotEmpty() || search.ingredient.isNotEmpty()
        val consumed =
            if (atlasSearch) {
                search.cursor?.let(::decodeAtlasCursor)?.consumed ?: search.offset
            } else {
                search.cursor?.let(::decodeBrowseCursor)?.consumed ?: search.offset
            }
        val rows =
            if (atlasSearch) {
                recipes.aggregate(searchPipeline(search, access, true) + listOf(
                    Document(
                        "\$set",
                        Document("searchScore", Document("\$meta", "searchScore"))
                            .append("paginationToken", Document("\$meta", "searchSequenceToken")),
                    ),
                    Document("\$sort", Document("searchScore", -1).append("name", 1).append("_id", 1)),
                    Document("\$limit", search.limit + 1),
                    Document("\$project", aggregateSummaryProjection()),
                )).toList()
            } else {
                recipes.find(Filters.and(combinedFilter(search, access), browseCursorFilter(search.cursor)))
                    .projection(findSummaryProjection())
                    .sort(Sorts.ascending("name", "_id"))
                    .limit(search.limit + 1)
                    .toList()
            }
        val hasMore = rows.size > search.limit
        val page = rows.take(search.limit)
        val total =
            if (hasMore) {
                SearchTotal(consumed + search.limit + 1, "lowerBound")
            } else if (consumed == 0 || page.isNotEmpty()) {
                SearchTotal(consumed + page.size, "exact")
            } else {
                null
            }
        return RecipeSearchResult(
            recipes = page.map { it.toSummary(access) },
            hasMore = hasMore,
            total = total,
            limit = search.limit,
            offset = consumed,
            nextCursor =
                if (!hasMore || page.isEmpty()) {
                    null
                } else if (atlasSearch) {
                    page.last().getString("paginationToken")?.let {
                        encodeAtlasCursor(it, consumed + page.size)
                    }
                } else {
                    encodeBrowseCursor(
                        page.last().getString("name").orEmpty(),
                        page.last().getString("_id"),
                        consumed + page.size,
                    )
                },
        )
    }

    override fun facets(search: RecipeSearch, access: RecipeAccess): List<RecipeFacet> {
        if (search.query.isEmpty() && search.ingredient.isEmpty() && search.scope == RecipeScope.CATALOG) {
            return tags.find(Filters.gt("recipeCount", 0))
                .sort(Document("recipeCount", -1).append("name", 1))
                .limit(250)
                .map { RecipeFacet(it.string("name"), it.number("recipeCount")?.toInt() ?: 0) }
                .toList()
        }
        val pipeline =
            searchPipeline(search, access) + listOf(
                Document("\$unwind", "\$tags"),
                Document("\$group", Document("_id", "\$tags").append("count", Document("\$sum", 1))),
                Document("\$sort", Document("count", -1).append("_id", 1)),
                Document("\$limit", 250),
            )
        return recipes.aggregate(pipeline)
            .map { RecipeFacet(it.string("_id"), it.number("count")?.toInt() ?: 0) }
            .toList()
    }

    override fun findById(id: String, access: RecipeAccess): RecipeDetail? {
        val document =
            recipes.find(Filters.and(Filters.eq("_id", id), accessFilter(RecipeScope.ALL, access))).first()
                ?: return null
        return document.toDetail(access)
    }

    override fun findSummariesByIds(ids: List<String>, access: RecipeAccess): Map<String, RecipeSummary> {
        if (ids.isEmpty()) return emptyMap()
        return recipes.find(
            Filters.and(
                Filters.`in`("_id", ids.distinct()),
                accessFilter(RecipeScope.ALL, access),
            ),
        ).projection(findSummaryProjection())
            .associate { it.getString("_id") to it.toSummary(access) }
    }

    override fun findByIds(ids: List<String>, access: RecipeAccess): Map<String, RecipeDetail> {
        if (ids.isEmpty()) return emptyMap()
        return recipes.find(
            Filters.and(
                Filters.`in`("_id", ids.distinct()),
                accessFilter(RecipeScope.ALL, access),
            ),
        ).associate { it.getString("_id") to it.toDetail(access) }
    }

    private fun findSummaryProjection() =
        Document("_id", 1)
            .append("sourceId", 1)
            .append("name", 1)
            .append("description", 1)
            .append("servings", 1)
            .append("tags", 1)
            .append("qualityFlags", 1)
            .append("visibility", 1)
            .append("origin", 1)
            .append("ownerUserId", 1)
            .append("recipeIngredients", Document("\$slice", 6))

    private fun aggregateSummaryProjection() =
        Document("_id", 1)
            .append("sourceId", 1)
            .append("name", 1)
            .append("description", 1)
            .append("servings", 1)
            .append("tags", 1)
            .append("qualityFlags", 1)
            .append("visibility", 1)
            .append("origin", 1)
            .append("ownerUserId", 1)
            .append("recipeIngredients", Document("\$slice", listOf("\$recipeIngredients", 6)))
            .append("paginationToken", 1)

    private fun searchPipeline(search: RecipeSearch, access: RecipeAccess, paginated: Boolean = false): List<Document> {
        val pipeline = mutableListOf<Document>()
        val must = mutableListOf<Document>()
        if (search.query.isNotEmpty()) {
            must +=
                Document(
                    "text",
                    Document("query", search.query)
                        .append(
                            "path",
                            listOf(
                                "name",
                                "description",
                                "recipeIngredients.ingredient",
                                "recipeIngredients.rawLine",
                                "tags",
                                "steps.instruction",
                            ),
                        ),
                )
        }
        if (search.ingredient.isNotEmpty()) {
            must +=
                Document(
                    "text",
                    Document("query", search.ingredient)
                        .append("path", listOf("recipeIngredients.ingredient", "recipeIngredients.rawLine")),
                )
        }
        if (must.isNotEmpty()) {
            val searchBody =
                Document("index", "recipes_v1")
                    .append("compound", Document("must", must))
            if (paginated) {
                searchBody.append(
                    "sort",
                    Document("score", Document("\$meta", "searchScore")).append("name", 1).append("_id", 1),
                )
                search.cursor?.let(::decodeAtlasCursor)?.let { searchBody.append("searchAfter", it.token) }
            }
            pipeline +=
                Document(
                    "\$search",
                    searchBody,
                )
        }
        pipeline += Document("\$match", combinedFilter(search, access))
        return pipeline
    }

    private fun combinedFilter(search: RecipeSearch, access: RecipeAccess): Bson {
        val filters = mutableListOf(accessFilter(search.scope, access))
        if (search.tags.isNotEmpty()) {
            filters +=
                if (search.tagMatch == TagMatch.ALL) {
                    Filters.all("tags", search.tags)
                } else {
                    Filters.`in`("tags", search.tags)
                }
        }
        return Filters.and(filters)
    }

    private fun browseCursorFilter(cursor: String?): Bson {
        val decoded = cursor?.let(::decodeBrowseCursor) ?: return Document()
        return Filters.or(
            Filters.gt("name", decoded.name),
            Filters.and(Filters.eq("name", decoded.name), Filters.gt("_id", decoded.id)),
        )
    }

    private data class BrowseCursor(val name: String, val id: String, val consumed: Int)

    private data class AtlasCursor(val token: String, val consumed: Int)

    private fun encodeBrowseCursor(name: String, id: String, consumed: Int): String =
        Base64.getUrlEncoder().withoutPadding()
            .encodeToString("$consumed\u0000$name\u0000$id".toByteArray(StandardCharsets.UTF_8))

    private fun decodeBrowseCursor(cursor: String): BrowseCursor? =
        runCatching {
            String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8)
                .split('\u0000', limit = 3)
                .takeIf { it.size == 3 }
                ?.let { BrowseCursor(it[1], it[2], it[0].toInt().coerceAtLeast(0)) }
        }.getOrNull()

    private fun encodeAtlasCursor(token: String, consumed: Int): String =
        Base64.getUrlEncoder().withoutPadding()
            .encodeToString("$consumed\u0000$token".toByteArray(StandardCharsets.UTF_8))

    private fun decodeAtlasCursor(cursor: String): AtlasCursor? =
        runCatching {
            String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8)
                .split('\u0000', limit = 2)
                .takeIf { it.size == 2 }
                ?.let { AtlasCursor(it[1], it[0].toInt().coerceAtLeast(0)) }
        }.getOrNull()

    private fun accessFilter(scope: RecipeScope, access: RecipeAccess): Bson {
        val active = Filters.eq("status", "active")
        val visible =
            when (scope) {
                RecipeScope.CATALOG -> Filters.eq("visibility", "catalog")
                RecipeScope.MINE -> Filters.eq("ownerUserId", access.userId)
                RecipeScope.HOUSEHOLD ->
                    Filters.and(
                        Filters.eq("visibility", "household"),
                        Filters.eq("ownerHouseholdId", access.householdId),
                    )
                RecipeScope.ALL ->
                    Filters.or(
                        Filters.eq("visibility", "catalog"),
                        Filters.eq("ownerUserId", access.userId),
                        Filters.and(
                            Filters.eq("visibility", "household"),
                            Filters.eq("ownerHouseholdId", access.householdId),
                        ),
                    )
            }
        return Filters.and(active, visible)
    }

    private fun Document.toSummary(access: RecipeAccess): RecipeSummary {
        val ingredientDocuments = documents("recipeIngredients")
        return RecipeSummary(
            id = string("_id"),
            sourceId = getString("sourceId") ?: string("_id"),
            name = getString("name").orEmpty(),
            description = getString("description").orEmpty(),
            servings = number("servings")?.toDouble(),
            tags = strings("tags"),
            ingredients = ingredientDocuments.take(6).map { it.getString("ingredient").orEmpty() },
            qualityFlags = strings("qualityFlags"),
            visibility = getString("visibility") ?: "catalog",
            origin = getString("origin") ?: "dataset",
            isOwner = getString("ownerUserId") == access.userId,
        )
    }

    private fun Document.toDetail(access: RecipeAccess): RecipeDetail {
        val summary = toSummary(access)
        return RecipeDetail(
            id = summary.id,
            sourceId = summary.sourceId,
            name = summary.name,
            description = summary.description,
            servings = summary.servings,
            tags = summary.tags,
            ingredients = summary.ingredients,
            qualityFlags = summary.qualityFlags,
            visibility = summary.visibility,
            origin = summary.origin,
            isOwner = summary.isOwner,
            servingSize = getString("servingSize"),
            steps =
                documents("steps").mapIndexed { index, step ->
                    RecipeStep(
                        position = step.number("position")?.toInt() ?: index,
                        instruction = step.getString("instruction").orEmpty(),
                        parseStatus = step.getString("parseStatus") ?: "parsed",
                    )
                },
            recipeIngredients =
                documents("recipeIngredients").mapIndexed { index, item ->
                    RecipeIngredient(
                        id = item.getString("id") ?: "$index",
                        position = item.number("position")?.toInt() ?: index,
                        rawLine = item.getString("rawLine").orEmpty(),
                        ingredient = item.getString("ingredient").orEmpty(),
                        quantityMin = item["quantityMin"]?.toString(),
                        quantityMax = item["quantityMax"]?.toString(),
                        unitId = item.getString("unitId"),
                        preparation = item.getString("preparation"),
                        parseStatus = item.getString("parseStatus") ?: "unresolved",
                    )
                },
        )
    }

    private fun Document.string(key: String): String = this[key]?.toString().orEmpty()

    private fun Document.number(key: String): Number? = this[key] as? Number

    private fun Document.strings(key: String): List<String> =
        (this[key] as? List<*>)?.mapNotNull { it as? String }.orEmpty()

    private fun Document.documents(key: String): List<Document> =
        (this[key] as? List<*>)?.mapNotNull {
            when (it) {
                is Document -> it
                is Map<*, *> -> Document(it.entries.associate { entry -> entry.key.toString() to entry.value })
                else -> null
            }
        }.orEmpty()
}

package com.tableplan.importer

import com.tableplan.quantity.QuantitySupport
import org.bson.Document

data class ImportIssue(
    val field: String,
    val severity: String,
    val reasonCode: String,
    val rawExcerpt: String,
)

data class ParsedRecipe(
    val id: String,
    val sourceId: String,
    val document: Document,
    val ingredients: List<Pair<String, String>>,
    val tags: List<Pair<String, String>>,
    val issues: List<ImportIssue>,
)

object RecipeImportParser {
    fun parse(row: Map<String, String>, sourceHash: String): ParsedRecipe {
        val issues = mutableListOf<ImportIssue>()
        val sourceId = row["id"].orEmpty().trim()
        require(sourceId.isNotEmpty()) { "Recipe source ID is required" }
        val recipeId = "recipe_$sourceId"
        val rawIngredients = parseList(row["ingredients_raw"].orEmpty(), "ingredients_raw", issues)
        val steps = parseList(row["steps"].orEmpty(), "steps", issues)
        val tagNames =
            parseList(row["tags"].orEmpty(), "tags", issues)
                .map(::normalizeTag).filter(String::isNotEmpty).distinct()
        val parsedIngredients =
            rawIngredients.mapIndexed { position, raw ->
                parseIngredient(recipeId, position, decode(raw), issues)
            }
        val servingText = row["servings"].orEmpty().trim()
        val servings = servingText.toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 }
        val qualityFlags = mutableListOf<String>()
        if (servings == null) {
            qualityFlags += "invalid_servings"
            issues += ImportIssue("servings", "warning", "invalid_servings", excerpt(servingText))
        } else if (servings > 50) {
            qualityFlags += "large_servings"
        }
        val document =
            Document("_id", recipeId)
                .append("sourceId", sourceId)
                .append("name", decode(row["name"].orEmpty()).trim().ifBlank { "Recipe $sourceId" })
                .append("description", decode(row["description"].orEmpty()).trim())
                .append("servings", servings)
                .append("servingSize", decode(row["serving_size"].orEmpty()).trim().ifBlank { null })
                .append("qualityFlags", qualityFlags)
                .append("tags", tagNames)
                .append("visibility", "catalog")
                .append("origin", "dataset")
                .append("status", "active")
                .append("sourceHash", sourceHash)
                .append("recipeIngredients", parsedIngredients.map { it.first })
                .append(
                    "steps",
                    steps.mapIndexed { position, instruction ->
                        Document("id", "${recipeId}_step_$position")
                            .append("position", position)
                            .append("instruction", decode(instruction).trim())
                            .append("parseStatus", "parsed")
                    },
                )
        return ParsedRecipe(
            recipeId,
            sourceId,
            document,
            parsedIngredients.mapNotNull { it.second },
            tagNames.map { stableId("tag", it) to it },
            issues,
        )
    }

    private fun parseIngredient(
        recipeId: String,
        position: Int,
        raw: String,
        issues: MutableList<ImportIssue>,
    ): Pair<Document, Pair<String, String>?> {
        val match =
            Regex("""^\s*((?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?|\d*[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s*(?:-|–|—|to)\s*(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?|\d*[¼½¾⅓⅔⅛⅜⅝⅞]))?)\s+(.+)$""", RegexOption.IGNORE_CASE)
                .find(raw)
        var ingredient = match?.groupValues?.get(2)?.trim() ?: raw.trim()
        val quantities = match?.groupValues?.get(1)?.replace(Regex("[–—]|\\s+to\\s+", RegexOption.IGNORE_CASE), "-")?.split("-", limit = 2)
        val minimum = quantities?.firstOrNull()?.let(QuantitySupport::parseNumber)
        val maximum = quantities?.getOrNull(1)?.let(QuantitySupport::parseNumber)
        val firstWord = ingredient.substringBefore(" ").lowercase()
        val unit = QuantitySupport.resolveUnit(firstWord)?.id
        if (unit != null) ingredient = ingredient.substringAfter(" ", "").trim()
        val preparation = ingredient.substringAfter(",", "").trim().ifBlank { null }
        ingredient = ingredient.substringBefore(",").trim()
        val normalized = normalizeIngredient(ingredient)
        val canonicalId = normalized.takeIf(String::isNotEmpty)?.let { stableId("ingredient", it) }
        val status = if (minimum == null) "unresolved" else if (unit == null) "partial" else "parsed"
        if (status != "parsed") {
            issues += ImportIssue("ingredients_raw", if (status == "unresolved") "warning" else "info", "ingredient_$status", excerpt(raw))
        }
        val document =
            Document("id", "${recipeId}_ingredient_$position")
                .append("position", position)
                .append("rawLine", raw)
                .append("ingredient", ingredient.ifBlank { raw })
                .append("canonicalIngredientId", canonicalId)
                .append("quantityMin", minimum?.stripTrailingZeros()?.toPlainString())
                .append("quantityMax", maximum?.stripTrailingZeros()?.toPlainString())
                .append("unitId", unit)
                .append("preparation", preparation)
                .append("parseStatus", status)
                .append("parseConfidence", if (status == "parsed") 1.0 else if (status == "partial") .55 else 0.0)
        return document to canonicalId?.let { it to normalized }
    }

    private fun parseList(input: String, field: String, issues: MutableList<ImportIssue>): List<String> {
        if (input.isBlank()) return emptyList()
        val body = input.trim().removePrefix("[").removeSuffix("]")
        val values = mutableListOf<String>()
        var current = StringBuilder()
        var quoted = false
        var escaped = false
        body.forEach { character ->
            when {
                escaped -> {
                    current.append(character)
                    escaped = false
                }
                character == '\\' -> escaped = true
                character == '"' -> quoted = !quoted
                character == ',' && !quoted -> {
                    values += current.toString().trim().trim('"')
                    current = StringBuilder()
                }
                else -> current.append(character)
            }
        }
        values += current.toString().trim().trim('"')
        if (quoted || !input.trim().startsWith("[") || !input.trim().endsWith("]")) {
            issues += ImportIssue(field, "warning", "repaired_json_array", excerpt(input))
        }
        return values.filter(String::isNotBlank)
    }

    private fun normalizeIngredient(value: String) =
        value.lowercase()
            .replace(Regex("""\([^)]*\)"""), " ")
            .replace(Regex("""\b(fresh|chopped|diced|minced|sliced|shredded|melted|cooked|optional)\b"""), " ")
            .replace(Regex("[^a-z0-9]+"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()

    private fun normalizeTag(value: String) = decode(value).lowercase().trim().replace(Regex("\\s+"), "-")

    private fun decode(value: String): String {
        var result = value
        repeat(3) {
            result =
                result.replace("&amp;", "&").replace("&quot;", "\"")
                    .replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">")
        }
        return result
    }

    private fun stableId(prefix: String, value: String): String {
        var hash = 0xcbf29ce484222325UL
        value.codePoints().forEach { point ->
            hash = hash xor point.toULong()
            hash *= 0x100000001b3UL
        }
        return "${prefix}_${hash.toString(16).padStart(16, '0')}"
    }

    private fun excerpt(value: String) = value.take(500)
}

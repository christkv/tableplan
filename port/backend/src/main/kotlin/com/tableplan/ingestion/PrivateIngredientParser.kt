package com.tableplan.ingestion

import com.tableplan.quantity.QuantitySupport

data class ParsedPrivateIngredient(
    val rawLine: String,
    val ingredient: String,
    val normalizedIngredient: String,
    val quantityMin: String?,
    val quantityMax: String?,
    val unitId: String?,
    val preparation: String?,
    val parseStatus: String,
)

object PrivateIngredientParser {
    private val quantityPattern =
        """(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?|\d*[¼½¾⅓⅔⅛⅜⅝⅞])"""

    fun parse(rawLine: String): ParsedPrivateIngredient {
        val match =
            Regex(
                """^\s*($quantityPattern(?:\s*(?:-|–|—|to)\s*$quantityPattern)?)\s+(.+)$""",
                RegexOption.IGNORE_CASE,
            ).find(rawLine)
        var ingredient = match?.groupValues?.get(2)?.trim() ?: rawLine.trim()
        val quantities =
            match?.groupValues?.get(1)
                ?.replace(Regex("[–—]|\\s+to\\s+", RegexOption.IGNORE_CASE), "-")
                ?.split("-", limit = 2)
        val minimum = quantities?.firstOrNull()?.let(QuantitySupport::parseNumber)
        val maximum = quantities?.getOrNull(1)?.let(QuantitySupport::parseNumber)
        val firstWord = ingredient.substringBefore(" ").lowercase()
        val unit = QuantitySupport.resolveUnit(firstWord)?.id
        if (unit != null) ingredient = ingredient.substringAfter(" ", "").trim()
        val preparation = ingredient.substringAfter(",", "").trim().ifBlank { null }
        ingredient = ingredient.substringBefore(",").trim().ifBlank { rawLine.trim() }
        val status = if (minimum == null) "unresolved" else if (unit == null) "partial" else "parsed"
        return ParsedPrivateIngredient(
            rawLine = rawLine,
            ingredient = ingredient,
            normalizedIngredient = normalize(ingredient),
            quantityMin = minimum?.stripTrailingZeros()?.toPlainString(),
            quantityMax = maximum?.stripTrailingZeros()?.toPlainString(),
            unitId = unit,
            preparation = preparation,
            parseStatus = status,
        )
    }

    fun normalize(value: String): String =
        value.lowercase()
            .replace(Regex("""\([^)]*\)"""), " ")
            .replace(Regex("""\b(fresh|chopped|diced|minced|sliced|shredded|melted|cooked|optional)\b"""), " ")
            .replace(Regex("[^a-z0-9]+"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
}

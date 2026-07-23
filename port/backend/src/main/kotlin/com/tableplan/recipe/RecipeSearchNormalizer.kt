package com.tableplan.recipe

object RecipeSearchNormalizer {
    const val MAX_TAGS = 12

    fun normalize(
        query: String?,
        ingredient: String?,
        tags: List<String>,
        tagMatch: String?,
        scope: String?,
        limit: Int?,
        offset: Int?,
        cursor: String? = null,
    ): RecipeSearch =
        RecipeSearch(
            query = query?.trim().orEmpty(),
            ingredient = ingredient?.trim().orEmpty(),
            tags =
                tags
                    .flatMap { it.split(",") }
                    .map(String::trim)
                    .filter(String::isNotEmpty)
                    .distinct()
                    .take(MAX_TAGS),
            tagMatch = if (tagMatch == "any") TagMatch.ANY else TagMatch.ALL,
            scope =
                when (scope) {
                    "catalog" -> RecipeScope.CATALOG
                    "mine" -> RecipeScope.MINE
                    "household" -> RecipeScope.HOUSEHOLD
                    else -> RecipeScope.ALL
                },
            limit = (limit ?: 24).coerceIn(1, 100),
            offset = (offset ?: 0).coerceIn(0, 100_000),
            cursor = cursor?.trim()?.takeIf { it.length in 1..2_000 },
        )
}

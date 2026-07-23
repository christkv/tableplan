package com.tableplan.recipe

data class RecipeAccess(
    val userId: String,
    val householdId: String,
)

enum class RecipeScope {
    ALL,
    CATALOG,
    MINE,
    HOUSEHOLD,
}

enum class TagMatch {
    ALL,
    ANY,
}

data class RecipeSearch(
    val query: String = "",
    val ingredient: String = "",
    val tags: List<String> = emptyList(),
    val tagMatch: TagMatch = TagMatch.ALL,
    val scope: RecipeScope = RecipeScope.ALL,
    val limit: Int = 24,
    val offset: Int = 0,
    val cursor: String? = null,
)

data class RecipeSummary(
    val id: String,
    val sourceId: String,
    val name: String,
    val description: String,
    val servings: Double?,
    val tags: List<String>,
    val ingredients: List<String>,
    val qualityFlags: List<String>,
    val visibility: String,
    val origin: String,
    val isOwner: Boolean,
)

data class RecipeIngredient(
    val id: String,
    val position: Int,
    val rawLine: String,
    val ingredient: String,
    val quantityMin: String?,
    val quantityMax: String?,
    val unitId: String?,
    val preparation: String?,
    val parseStatus: String,
)

data class RecipeStep(
    val position: Int,
    val instruction: String,
    val parseStatus: String,
)

data class RecipeDetail(
    val id: String,
    val sourceId: String,
    val name: String,
    val description: String,
    val servings: Double?,
    val tags: List<String>,
    val ingredients: List<String>,
    val qualityFlags: List<String>,
    val visibility: String,
    val origin: String,
    val isOwner: Boolean,
    val servingSize: String?,
    val steps: List<RecipeStep>,
    val recipeIngredients: List<RecipeIngredient>,
)

data class SearchTotal(
    val value: Int,
    val relation: String,
)

data class RecipeSearchResult(
    val recipes: List<RecipeSummary>,
    val hasMore: Boolean,
    val total: SearchTotal?,
    val limit: Int,
    val offset: Int,
    val nextCursor: String?,
)

data class RecipeFacet(
    val name: String,
    val recipeCount: Int,
)

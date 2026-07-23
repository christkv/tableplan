package com.tableplan.recipe

interface RecipeRepository {
    fun search(search: RecipeSearch, access: RecipeAccess): RecipeSearchResult

    fun facets(search: RecipeSearch, access: RecipeAccess): List<RecipeFacet>

    fun findById(id: String, access: RecipeAccess): RecipeDetail?

    fun findSummariesByIds(ids: List<String>, access: RecipeAccess): Map<String, RecipeSummary>

    fun findByIds(ids: List<String>, access: RecipeAccess): Map<String, RecipeDetail>
}

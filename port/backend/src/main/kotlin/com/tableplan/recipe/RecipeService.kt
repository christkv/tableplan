package com.tableplan.recipe

import com.tableplan.config.PerformanceMetrics
import org.springframework.stereotype.Service
import java.util.concurrent.ConcurrentHashMap

@Service
class RecipeService(
    private val repository: RecipeRepository,
    private val metrics: PerformanceMetrics,
) {
    private data class FacetCacheEntry(val expiresAt: Long, val value: List<RecipeFacet>)

    private val facetCache = ConcurrentHashMap<String, FacetCacheEntry>()

    fun search(search: RecipeSearch, access: RecipeAccess) =
        metrics.record("recipe.search") { repository.search(search, access) }

    fun facets(search: RecipeSearch, access: RecipeAccess): List<RecipeFacet> {
        val key =
            listOf(
                access.userId,
                access.householdId,
                search.query,
                search.ingredient,
                search.scope.name,
            ).joinToString("\u0000")
        val now = System.currentTimeMillis()
        facetCache[key]?.takeIf { it.expiresAt > now }?.let { return it.value }
        val value = metrics.record("recipe.facets") { repository.facets(search, access) }
        if (facetCache.size >= 500) facetCache.entries.removeIf { it.value.expiresAt <= now }
        if (facetCache.size >= 500) facetCache.clear()
        facetCache[key] = FacetCacheEntry(now + 15_000, value)
        return value
    }

    fun findById(id: String, access: RecipeAccess) = repository.findById(id, access)

    fun findSummariesByIds(ids: List<String>, access: RecipeAccess) = repository.findSummariesByIds(ids, access)

    fun findByIds(ids: List<String>, access: RecipeAccess) = repository.findByIds(ids, access)
}

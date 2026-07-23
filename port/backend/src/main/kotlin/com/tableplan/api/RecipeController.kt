package com.tableplan.api

import com.tableplan.recipe.RecipeAccessResolver
import com.tableplan.recipe.RecipeSearchNormalizer
import com.tableplan.recipe.RecipeService
import jakarta.validation.constraints.Max
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.Size
import org.springframework.security.core.Authentication
import org.springframework.validation.annotation.Validated
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@Validated
@RestController
class RecipeController(
    private val recipes: RecipeService,
    private val accessResolver: RecipeAccessResolver,
) {
    @GetMapping("/api/v1/recipes/search")
    fun search(
        @RequestParam("q", required = false) @Size(max = 500) query: String?,
        @RequestParam(required = false) @Size(max = 200) ingredient: String?,
        @RequestParam("tag", required = false) tags: List<String>?,
        @RequestParam(required = false) tagMatch: String?,
        @RequestParam(required = false) scope: String?,
        @RequestParam(required = false) @Min(1) @Max(100) limit: Int?,
        @RequestParam(required = false) @Min(0) @Max(100_000) offset: Int?,
        @RequestParam(required = false) @Size(max = 2_000) cursor: String?,
        authentication: Authentication?,
    ) = recipes.search(
        RecipeSearchNormalizer.normalize(query, ingredient, tags.orEmpty(), tagMatch, scope, limit, offset, cursor),
        accessResolver.resolve(authentication),
    )

    @GetMapping("/api/v1/recipes/facets")
    fun facets(
        @RequestParam("q", required = false) @Size(max = 500) query: String?,
        @RequestParam(required = false) @Size(max = 200) ingredient: String?,
        @RequestParam(required = false) scope: String?,
        authentication: Authentication?,
    ) = recipes.facets(
        RecipeSearchNormalizer.normalize(query, ingredient, emptyList(), null, scope, 250, 0),
        accessResolver.resolve(authentication),
    )

    @GetMapping("/api/v1/recipes/{recipeId}")
    fun detail(
        @PathVariable @Size(min = 1, max = 200) recipeId: String,
        authentication: Authentication?,
    ) = recipes.findById(recipeId, accessResolver.resolve(authentication))
        ?: throw ApiException(404, "recipe_not_found", "Recipe not found")
}

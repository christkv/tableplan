package com.tableplan.importer

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RecipeImportParserTest {
    @Test
    fun `preserves compatibility IDs and parses fixture-shaped rows`() {
        val recipe =
            RecipeImportParser.parse(
                mapOf(
                    "id" to "42",
                    "name" to "Tomato Toast",
                    "description" to "Fast lunch",
                    "ingredients_raw" to "[\"2 slices bread\", \"1 lb tomatoes, chopped\"]",
                    "steps" to "[\"Toast bread\", \"Top with tomatoes\"]",
                    "servings" to "2",
                    "serving_size" to "1 plate",
                    "tags" to "[\"Lunch\", \"15-minutes-or-less\"]",
                ),
                "source-hash",
            )
        assertEquals("recipe_42", recipe.id)
        assertEquals(listOf("lunch", "15-minutes-or-less"), recipe.document.getList("tags", String::class.java))
        assertEquals("slice", recipe.document.getList("recipeIngredients", org.bson.Document::class.java)[0].getString("unitId"))
        assertTrue(recipe.ingredients.isNotEmpty())
    }
}

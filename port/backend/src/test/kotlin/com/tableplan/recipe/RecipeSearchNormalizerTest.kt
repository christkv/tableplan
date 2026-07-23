package com.tableplan.recipe

import kotlin.test.Test
import kotlin.test.assertEquals

class RecipeSearchNormalizerTest {
    @Test
    fun `normalizes tags exactly like the compatibility source`() {
        val result =
            RecipeSearchNormalizer.normalize(
                query = "  soup ",
                ingredient = " tomato ",
                tags = listOf("quick, family", "quick", ""),
                tagMatch = "any",
                scope = "mine",
                limit = 500,
                offset = -1,
                cursor = "  next-page-token  ",
            )

        assertEquals("soup", result.query)
        assertEquals("tomato", result.ingredient)
        assertEquals(listOf("quick", "family"), result.tags)
        assertEquals(TagMatch.ANY, result.tagMatch)
        assertEquals(RecipeScope.MINE, result.scope)
        assertEquals(100, result.limit)
        assertEquals(0, result.offset)
        assertEquals("next-page-token", result.cursor)
    }
}

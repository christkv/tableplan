package com.tableplan.ingestion

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

class PrivateIngredientParserTest {
    @Test
    fun `parses quantity unit ingredient and preparation for reviewed recipes`() {
        val parsed = PrivateIngredientParser.parse("2 tbsp Fresh olive oil, divided")

        assertEquals("2", parsed.quantityMin)
        assertEquals("tbsp", parsed.unitId)
        assertEquals("Fresh olive oil", parsed.ingredient)
        assertEquals("olive oil", parsed.normalizedIngredient)
        assertEquals("divided", parsed.preparation)
        assertEquals("parsed", parsed.parseStatus)
    }

    @Test
    fun `preserves an unresolved ingredient line for review`() {
        val parsed = PrivateIngredientParser.parse("salt to taste")

        assertEquals("salt to taste", parsed.ingredient)
        assertEquals(null, parsed.quantityMin)
        assertEquals("unresolved", parsed.parseStatus)
    }
}

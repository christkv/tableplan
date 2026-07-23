package com.tableplan.quantity

import java.math.BigDecimal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class QuantitySupportTest {
    @Test
    fun `parses decimals fractions vulgar fractions and ranges`() {
        assertEquals(BigDecimal("1.5"), QuantitySupport.parseNumber("1 1/2")?.stripTrailingZeros())
        assertEquals(BigDecimal("2.25"), QuantitySupport.parseNumber("2¼")?.stripTrailingZeros())
        assertEquals(
            QuantityRange(BigDecimal("1"), BigDecimal("2")),
            QuantitySupport.parseRange("1 to 2"),
        )
        assertNull(QuantitySupport.parseNumber("a handful"))
        assertNull(QuantitySupport.parseRange("2-1"))
    }

    @Test
    fun `resolves aliases and converts only compatible dimensions`() {
        assertEquals("tbsp", QuantitySupport.resolveUnit("tablespoons")?.id)
        assertEquals(
            "1000",
            QuantitySupport.convert(BigDecimal.ONE, "kg", "g")?.toPlainString(),
        )
        assertNull(QuantitySupport.convert(BigDecimal.ONE, "cup", "g"))
    }
}

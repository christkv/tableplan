package com.tableplan.quantity

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

data class QuantityRange(
    val minimum: BigDecimal,
    val maximum: BigDecimal? = null,
)

data class UnitDefinition(
    val id: String,
    val dimension: String,
    val toBase: BigDecimal,
)

object QuantitySupport {
    private val fractions =
        mapOf(
            '¼' to "0.25",
            '½' to "0.5",
            '¾' to "0.75",
            '⅓' to "0.3333333333333333",
            '⅔' to "0.6666666666666667",
            '⅛' to "0.125",
            '⅜' to "0.375",
            '⅝' to "0.625",
            '⅞' to "0.875",
        )
    private val definitions =
        listOf(
            UnitDefinition("g", "mass", BigDecimal.ONE),
            UnitDefinition("kg", "mass", BigDecimal("1000")),
            UnitDefinition("oz", "mass", BigDecimal("28.349523125")),
            UnitDefinition("lb", "mass", BigDecimal("453.59237")),
            UnitDefinition("ml", "volume", BigDecimal.ONE),
            UnitDefinition("l", "volume", BigDecimal("1000")),
            UnitDefinition("tsp", "volume", BigDecimal("4.92892159375")),
            UnitDefinition("tbsp", "volume", BigDecimal("14.78676478125")),
            UnitDefinition("cup", "volume", BigDecimal("236.5882365")),
            UnitDefinition("slice", "count", BigDecimal.ONE),
            UnitDefinition("clove", "count", BigDecimal.ONE),
        ).associateBy(UnitDefinition::id)
    private val aliases =
        mapOf(
            "gram" to "g", "grams" to "g",
            "kilogram" to "kg", "kilograms" to "kg",
            "ounce" to "oz", "ounces" to "oz",
            "lbs" to "lb", "pound" to "lb", "pounds" to "lb",
            "milliliter" to "ml", "milliliters" to "ml",
            "liter" to "l", "liters" to "l",
            "tsp." to "tsp", "teaspoon" to "tsp", "teaspoons" to "tsp",
            "tbsp." to "tbsp", "tablespoon" to "tbsp", "tablespoons" to "tbsp",
            "cups" to "cup", "slices" to "slice", "cloves" to "clove",
        )

    fun parseNumber(value: String): BigDecimal? {
        val text = value.trim()
        fractions[text.singleOrNull()]?.let(::BigDecimal)?.let { return it }
        Regex("""^(\d+)([¼½¾⅓⅔⅛⅜⅝⅞])$""").matchEntire(text)?.let {
            return BigDecimal(it.groupValues[1]) + BigDecimal(fractions.getValue(it.groupValues[2][0]))
        }
        Regex("""^(\d+)\s+(\d+)/(\d+)$""").matchEntire(text)?.let {
            return fraction(it.groupValues[2], it.groupValues[3])?.plus(BigDecimal(it.groupValues[1]))
        }
        Regex("""^(\d+)/(\d+)$""").matchEntire(text)?.let {
            return fraction(it.groupValues[1], it.groupValues[2])
        }
        return text.toBigDecimalOrNull()?.takeIf { it.signum() >= 0 }
    }

    fun parseRange(value: String): QuantityRange? {
        val parts =
            value.trim()
                .replace(Regex("""\s+(?:to)\s+""", RegexOption.IGNORE_CASE), "-")
                .replace(Regex("[–—]"), "-")
                .split(Regex("""\s*-\s*"""), limit = 2)
        val minimum = parseNumber(parts[0]) ?: return null
        val maximum = parts.getOrNull(1)?.let(::parseNumber)
        if (parts.size == 2 && maximum == null) return null
        if (maximum != null && maximum < minimum) return null
        return QuantityRange(minimum, maximum)
    }

    fun resolveUnit(value: String?): UnitDefinition? {
        val normalized = value?.trim()?.lowercase() ?: return null
        return definitions[aliases[normalized] ?: normalized]
    }

    fun preferredUnit(unitId: String, measurementSystem: String): String {
        val unit = resolveUnit(unitId) ?: return unitId
        return when (measurementSystem) {
            "metric" -> if (unit.dimension == "mass") "g" else if (unit.dimension == "volume") "ml" else unit.id
            "us" -> if (unit.dimension == "mass") "oz" else if (unit.dimension == "volume") "cup" else unit.id
            else -> unit.id
        }
    }

    fun convert(value: BigDecimal, fromUnit: String, toUnit: String): BigDecimal? {
        val from = resolveUnit(fromUnit) ?: return null
        val to = resolveUnit(toUnit) ?: return null
        if (from.dimension != to.dimension) return null
        return value.multiply(from.toBase).divide(to.toBase, MathContext(16, RoundingMode.HALF_UP))
    }

    private fun fraction(numerator: String, denominator: String): BigDecimal? {
        val divisor = BigDecimal(denominator)
        if (divisor.signum() == 0) return null
        return BigDecimal(numerator).divide(divisor, 16, RoundingMode.HALF_UP)
    }
}

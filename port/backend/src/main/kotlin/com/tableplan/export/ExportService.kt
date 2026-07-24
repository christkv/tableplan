package com.tableplan.export

import com.tableplan.api.ApiException
import com.tableplan.auth.TableplanPrincipal
import com.tableplan.planning.MealPlan
import com.tableplan.planning.PlanService
import com.tableplan.quantity.QuantitySupport
import com.tableplan.recipe.RecipeAccess
import com.tableplan.recipe.RecipeDetail
import com.tableplan.recipe.RecipeIngredient
import com.tableplan.recipe.RecipeService
import com.tableplan.shopping.ShoppingItem
import com.tableplan.shopping.ShoppingList
import com.tableplan.shopping.ShoppingService
import com.tableplan.tenant.TenantService
import org.springframework.stereotype.Service
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

data class ExportDocument(
    val filename: String,
    val bytes: ByteArray,
)

@Service
class ExportService(
    private val recipes: RecipeService,
    private val plans: PlanService,
    private val shopping: ShoppingService,
    private val tenant: TenantService,
    private val renderer: PdfRenderer,
) {
    fun recipe(
        principal: TableplanPrincipal,
        id: String,
        paper: String,
        measurementSystem: String? = null,
        servings: Double? = null,
    ): ExportDocument {
        requirePaper(paper)
        val recipe =
            recipes.findById(id, RecipeAccess(principal.userId, principal.householdId))
                ?: throw ApiException(404, "recipe_not_found", "Recipe not found.")
        val system = measurementSystem ?: tenant.preferences(principal).measurementSystem
        requireMeasurement(system)
        val targetServings = servings ?: recipe.servings
        if (targetServings != null && (!targetServings.isFinite() || targetServings !in 0.25..1_000.0)) {
            throw ApiException(400, "servings_invalid", "Servings must be between 0.25 and 1000.")
        }
        val model = recipeModel(recipe, system, targetServings)
        return ExportDocument(
            filename = safeFilename(recipe.name) + ".pdf",
            bytes = renderer.render(model, paper),
        )
    }

    fun plan(principal: TableplanPrincipal, id: String, paper: String): ExportDocument {
        requirePaper(paper)
        val plan =
            plans.getById(principal, id)
                ?: throw ApiException(404, "plan_not_found", "Meal plan not found.")
        return ExportDocument(
            filename = safeFilename(plan.name) + ".pdf",
            bytes = renderer.render(planModel(principal, plan), paper),
        )
    }

    fun shopping(
        principal: TableplanPrincipal,
        id: String,
        paper: String,
        measurementSystem: String? = null,
        includeCheckedItems: Boolean = true,
        includeSourceRecipes: Boolean = true,
    ): ExportDocument {
        requirePaper(paper)
        val list =
            shopping.getById(principal, id)
                ?: throw ApiException(404, "shopping_list_not_found", "Shopping list not found.")
        val system = measurementSystem ?: list.measurementSystem
        requireMeasurement(system)
        return ExportDocument(
            filename = safeFilename(list.name) + ".pdf",
            bytes = renderer.render(shoppingModel(list, system, includeCheckedItems, includeSourceRecipes), paper),
        )
    }

    fun combined(
        principal: TableplanPrincipal,
        planId: String,
        shoppingListId: String,
        paper: String,
        measurementSystem: String? = null,
        includeCheckedItems: Boolean = true,
        includeSourceRecipes: Boolean = true,
    ): ExportDocument {
        requirePaper(paper)
        val plan =
            plans.getById(principal, planId)
                ?: throw ApiException(404, "plan_not_found", "Meal plan not found.")
        val list =
            shopping.getById(principal, shoppingListId)
                ?: throw ApiException(404, "shopping_list_not_found", "Shopping list not found.")
        if (list.plan?.id != plan.id) {
            throw ApiException(409, "plan_list_mismatch", "Shopping list does not belong to the meal plan.")
        }
        val system = measurementSystem ?: list.measurementSystem
        requireMeasurement(system)
        val model =
            CombinedPdfModel(
                plan = planModel(principal, plan),
                shoppingList = shoppingModel(list, system, includeCheckedItems, includeSourceRecipes),
            )
        return ExportDocument(
            filename = safeFilename("${plan.name} combined") + ".pdf",
            bytes = renderer.render(model, paper),
        )
    }

    private fun recipeModel(
        recipe: RecipeDetail,
        measurementSystem: String,
        targetServings: Double?,
    ): RecipePdfModel {
        val originalServings = recipe.servings?.takeIf { it > 0 }
        val scale =
            if (targetServings != null && originalServings != null) {
                BigDecimal.valueOf(targetServings).divide(BigDecimal.valueOf(originalServings), 12, RoundingMode.HALF_UP)
            } else {
                BigDecimal.ONE
            }
        return RecipePdfModel(
            title = recipe.name,
            description = recipe.description,
            servings = targetServings,
            measurementSystem = measurementSystem,
            tags = recipe.tags,
            ingredients = recipe.recipeIngredients.sortedBy { it.position }.map { ingredientModel(it, measurementSystem, scale) },
            steps = recipe.steps.sortedBy { it.position }.map { it.instruction },
        )
    }

    private fun ingredientModel(
        ingredient: RecipeIngredient,
        measurementSystem: String,
        scale: BigDecimal,
    ): PdfIngredient {
        val fallback = ingredient.rawLine.ifBlank { ingredient.ingredient }
        val unresolved = ingredient.parseStatus != "parsed"
        if (unresolved || ingredient.quantityMin == null) {
            return PdfIngredient(fallback, unresolved)
        }
        if (measurementSystem == "original" && scale.compareTo(BigDecimal.ONE) == 0) {
            return PdfIngredient(fallback, false)
        }
        val minimum = ingredient.quantityMin.toBigDecimalOrNull()?.multiply(scale)
        val maximum = ingredient.quantityMax?.toBigDecimalOrNull()?.multiply(scale)
        val sourceUnit = ingredient.unitId
        if (sourceUnit != null && QuantitySupport.resolveUnit(sourceUnit) == null) {
            return PdfIngredient(fallback, false)
        }
        val targetUnit = sourceUnit?.let { preferredPdfUnit(it, measurementSystem, minimum) }
        val convertedMinimum =
            if (minimum != null && sourceUnit != null && targetUnit != null) {
                QuantitySupport.convert(minimum, sourceUnit, targetUnit) ?: minimum
            } else {
                minimum
            }
        val convertedMaximum =
            if (maximum != null && sourceUnit != null && targetUnit != null) {
                QuantitySupport.convert(maximum, sourceUnit, targetUnit) ?: maximum
            } else {
                maximum
            }
        val quantity = quantity(convertedMinimum, convertedMaximum, targetUnit)
        val name =
            listOfNotNull(
                ingredient.ingredient.takeIf(String::isNotBlank),
                ingredient.preparation?.takeIf(String::isNotBlank)?.let { ", $it" },
            ).joinToString("")
        val formatted = listOf(quantity, name).filter(String::isNotBlank).joinToString(" ")
        return PdfIngredient(formatted.ifBlank { fallback }, false)
    }

    private fun planModel(principal: TableplanPrincipal, plan: MealPlan): MealPlanPdfModel {
        val configuredSlots = tenant.preferences(principal).mealSlots.map { PdfMealSlot(it.id, it.label) }
        val configuredIds = configuredSlots.mapTo(mutableSetOf()) { it.id }
        val legacySlots =
            plan.items.map { it.mealSlot }.distinct().filterNot(configuredIds::contains).map {
                PdfMealSlot(it, slotLabel(it))
            }
        val start = LocalDate.parse(plan.startsOn)
        val end = LocalDate.parse(plan.endsOn)
        val days =
            generateSequence(start) { previous -> previous.plusDays(1).takeUnless { it.isAfter(end) } }
                .take(7)
                .map { date ->
                    PdfPlanDay(
                        date = date.toString(),
                        label = date.format(DAY_LABEL),
                        meals =
                            plan.items.filter { it.plannedDate == date.toString() }
                                .sortedBy { item -> (configuredSlots + legacySlots).indexOfFirst { it.id == item.mealSlot } }
                                .map {
                                    PdfMeal(
                                        slotId = it.mealSlot,
                                        recipeName = it.recipeName,
                                        servings = it.servings,
                                        notes = it.notes,
                                    )
                                },
                    )
                }.toList()
        return MealPlanPdfModel(
            title = plan.name,
            startsOn = plan.startsOn,
            endsOn = plan.endsOn,
            slots = configuredSlots + legacySlots,
            days = days,
        )
    }

    private fun shoppingModel(
        list: ShoppingList,
        measurementSystem: String,
        includeCheckedItems: Boolean,
        includeSourceRecipes: Boolean,
    ) = ShoppingListPdfModel(
        title = list.name,
        startsOn = list.plan?.startsOn,
        endsOn = list.plan?.endsOn,
        measurementSystem = measurementSystem,
        items =
            list.items.asSequence()
                .filter { includeCheckedItems || !it.checked }
                .map { shoppingItemModel(it, list.measurementSystem, measurementSystem, includeSourceRecipes) }
                .toList(),
    )

    private fun shoppingItemModel(
        item: ShoppingItem,
        sourceMeasurementSystem: String,
        targetMeasurementSystem: String,
        includeSourceRecipes: Boolean,
    ): PdfShoppingItem {
        val sourceUnit = item.unitId
        val targetUnit =
            if (targetMeasurementSystem == "original" && sourceMeasurementSystem != "original") {
                sourceUnit
            } else {
                sourceUnit?.let {
                    preferredPdfUnit(it, targetMeasurementSystem, item.quantityMin?.toBigDecimalOrNull())
                }
            }
        val minimum = converted(item.quantityMin, sourceUnit, targetUnit)
        val maximum = converted(item.quantityMax, sourceUnit, targetUnit)
        return PdfShoppingItem(
            name = item.name,
            quantity = quantity(minimum, maximum, targetUnit),
            checked = item.checked,
            unresolved = item.unresolved,
            sources = if (includeSourceRecipes) item.sources.map { it.recipeName }.distinct() else emptyList(),
        )
    }

    private fun converted(value: String?, sourceUnit: String?, targetUnit: String?): BigDecimal? {
        val number = value?.toBigDecimalOrNull() ?: return null
        if (sourceUnit == null || targetUnit == null) return number
        return QuantitySupport.convert(number, sourceUnit, targetUnit) ?: number
    }

    private fun quantity(minimum: BigDecimal?, maximum: BigDecimal?, unit: String?): String {
        if (minimum == null) return unit.orEmpty()
        val range =
            if (maximum != null) {
                "${number(minimum)}-${number(maximum)}"
            } else {
                number(minimum)
            }
        return listOfNotNull(range, displayUnit(unit, minimum, maximum)).joinToString(" ")
    }

    private fun number(value: BigDecimal): String {
        val numeric = value.toDouble()
        val whole = floor(numeric + 1e-9).toLong()
        val fraction = numeric - whole
        val common =
            listOf(
                .125 to "1/8",
                .25 to "1/4",
                (1.0 / 3.0) to "1/3",
                .5 to "1/2",
                (2.0 / 3.0) to "2/3",
                .75 to "3/4",
                .875 to "7/8",
            ).firstOrNull { abs(it.first - fraction) < .015 }
        if (common != null) return if (whole > 0) "$whole ${common.second}" else common.second
        return value.setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
    }

    private fun displayUnit(unit: String?, minimum: BigDecimal, maximum: BigDecimal?): String? {
        if (unit.isNullOrBlank()) return null
        val plural = minimum.compareTo(BigDecimal.ONE) != 0 || maximum?.compareTo(BigDecimal.ONE) == 1
        if (!plural) return unit
        return PLURAL_UNITS[unit] ?: unit
    }

    private fun preferredPdfUnit(
        sourceUnit: String,
        measurementSystem: String,
        minimum: BigDecimal?,
    ): String {
        if (measurementSystem == "original") return sourceUnit
        val definition = QuantitySupport.resolveUnit(sourceUnit) ?: return sourceUnit
        val base = minimum?.multiply(definition.toBase) ?: BigDecimal.ZERO
        return when (definition.dimension) {
            "mass" ->
                if (measurementSystem == "metric") {
                    if (base >= BigDecimal("1000")) "kg" else "g"
                } else {
                    if (base >= BigDecimal("453.59237")) "lb" else "oz"
                }
            "volume" ->
                if (measurementSystem == "metric") {
                    if (base >= BigDecimal("1000")) "l" else "ml"
                } else {
                    when {
                        base >= BigDecimal("236.5882365") -> "cup"
                        base >= BigDecimal("14.78676478125") -> "tbsp"
                        else -> "tsp"
                    }
                }
            else -> sourceUnit
        }
    }

    private fun slotLabel(value: String): String =
        value.replace('_', ' ').replace('-', ' ').split(' ')
            .filter(String::isNotBlank)
            .joinToString(" ") { it.replaceFirstChar(Char::uppercase) }
            .ifBlank { value }

    private fun requirePaper(value: String) {
        if (value !in setOf("a4", "letter")) {
            throw ApiException(400, "paper_invalid", "Paper must be a4 or letter.")
        }
    }

    private fun requireMeasurement(value: String) {
        if (value !in setOf("original", "us", "metric")) {
            throw ApiException(400, "measurement_invalid", "Measurement system must be original, metric, or US.")
        }
    }

    private fun safeFilename(value: String) =
        value.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(80).ifBlank { "table-rhythm-export" }

    private companion object {
        val DAY_LABEL: DateTimeFormatter = DateTimeFormatter.ofPattern("EEEE, MMM d", Locale.ENGLISH)
        val PLURAL_UNITS =
            mapOf(
                "cup" to "cups",
                "clove" to "cloves",
                "slice" to "slices",
                "bunch" to "bunches",
                "pinch" to "pinches",
                "dash" to "dashes",
                "can" to "cans",
                "bag" to "bags",
                "box" to "boxes",
                "jar" to "jars",
            )
    }
}

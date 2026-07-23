package com.tableplan.export

import com.tableplan.api.ApiException
import com.tableplan.auth.TableplanPrincipal
import com.tableplan.planning.MealPlan
import com.tableplan.planning.PlanService
import com.tableplan.recipe.RecipeAccess
import com.tableplan.recipe.RecipeDetail
import com.tableplan.recipe.RecipeService
import com.tableplan.shopping.ShoppingList
import com.tableplan.shopping.ShoppingService
import org.springframework.stereotype.Service

data class ExportDocument(
    val filename: String,
    val bytes: ByteArray,
)

@Service
class ExportService(
    private val recipes: RecipeService,
    private val plans: PlanService,
    private val shopping: ShoppingService,
    private val renderer: PdfRenderer,
) {
    fun recipe(principal: TableplanPrincipal, id: String, paper: String): ExportDocument {
        requirePaper(paper)
        val recipe =
            recipes.findById(id, RecipeAccess(principal.userId, principal.householdId))
                ?: throw ApiException(404, "recipe_not_found", "Recipe not found.")
        return document(
            recipe.name,
            paper,
            listOf(recipe.name, recipe.description, "", "Ingredients") +
                recipe.recipeIngredients.map { "• ${it.rawLine.ifBlank { it.ingredient }}" } +
                listOf("", "Method") +
                recipe.steps.mapIndexed { index, step -> "${index + 1}. ${step.instruction}" },
        )
    }

    fun plan(principal: TableplanPrincipal, id: String, paper: String): ExportDocument {
        requirePaper(paper)
        val plan =
            plans.getById(principal, id)
                ?: throw ApiException(404, "plan_not_found", "Meal plan not found.")
        return document(
            plan.name,
            paper,
            listOf(plan.name, "${plan.startsOn} – ${plan.endsOn}", "") +
                plan.items.sortedWith(compareBy({ it.plannedDate }, { it.mealSlot }))
                    .map { "${it.plannedDate}  ${it.mealSlot}: ${it.recipeName} (${it.servings} servings)" },
        )
    }

    fun shopping(principal: TableplanPrincipal, id: String, paper: String): ExportDocument {
        requirePaper(paper)
        val list =
            shopping.getById(principal, id)
                ?: throw ApiException(404, "shopping_list_not_found", "Shopping list not found.")
        return document(
            list.name,
            paper,
            listOf(list.name, "") +
                list.items.map {
                    val quantity = listOfNotNull(it.quantityMin, it.unitId).joinToString(" ")
                    "${if (it.checked) "☑" else "☐"}  $quantity ${it.name}".trimEnd()
                },
        )
    }

    fun combined(
        principal: TableplanPrincipal,
        planId: String,
        shoppingListId: String,
        paper: String,
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
        return document(
            "${plan.name} combined",
            paper,
            listOf(plan.name, "${plan.startsOn} – ${plan.endsOn}", "") +
                plan.items.sortedWith(compareBy({ it.plannedDate }, { it.mealSlot }))
                    .map { "${it.plannedDate}  ${it.mealSlot}: ${it.recipeName} (${it.servings} servings)" } +
                listOf("", "Shopping list", "") +
                list.items.map {
                    val quantity = listOfNotNull(it.quantityMin, it.unitId).joinToString(" ")
                    "${if (it.checked) "☑" else "☐"}  $quantity ${it.name}".trimEnd()
                },
        )
    }

    private fun document(title: String, paper: String, lines: List<String>): ExportDocument =
        ExportDocument(
            filename = safeFilename(title) + ".pdf",
            bytes = renderer.render(lines, paper),
        )

    private fun requirePaper(value: String) {
        if (value !in setOf("a4", "letter")) {
            throw ApiException(400, "paper_invalid", "Paper must be a4 or letter.")
        }
    }

    private fun safeFilename(value: String) =
        value.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(80).ifBlank { "tableplan-export" }

}

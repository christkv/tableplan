package com.tableplan.mcp

import com.tableplan.api.ApiException
import com.tableplan.auth.AuthenticationKind
import com.tableplan.auth.TableplanPrincipal
import com.tableplan.email.EmailDeliveryService
import com.tableplan.ingestion.IngestionService
import com.tableplan.planning.PlanService
import com.tableplan.recipe.RecipeAccess
import com.tableplan.recipe.RecipeSearchNormalizer
import com.tableplan.recipe.RecipeService
import com.tableplan.sharing.ShoppingShareService
import com.tableplan.shopping.ShoppingService
import com.tableplan.tenant.TenantService
import org.springframework.stereotype.Service

data class McpTool(
    val name: String,
    val description: String,
    val inputSchema: Map<String, Any>,
    val annotations: Map<String, Any>,
)

@Service
class McpToolService(
    private val recipes: RecipeService,
    private val tenants: TenantService,
    private val ingestions: IngestionService,
    private val plans: PlanService,
    private val shopping: ShoppingService,
    private val shares: ShoppingShareService,
    private val email: EmailDeliveryService,
) {
    val tools =
        listOf(
            tool("search_recipes", "Search recipes visible to the current household.", props("query", "ingredient", "scope", "limit"), readOnly = true),
            tool("list_saved_searches", "List saved recipe searches.", emptyMap(), readOnly = true),
            tool("save_recipe_search", "Save a reusable recipe search.", props("name", "query", "ingredient", "scope"), required = listOf("name")),
            tool("delete_saved_search", "Delete a saved recipe search.", props("id"), required = listOf("id"), destructive = true),
            tool("get_recipe", "Get a visible recipe by ID.", props("recipeId"), required = listOf("recipeId"), readOnly = true),
            tool("import_recipe_text", "Create a private recipe ingestion from text.", props("text", "filename"), required = listOf("text")),
            tool("get_recipe_import", "Get a private recipe ingestion.", props("ingestionId"), required = listOf("ingestionId"), readOnly = true),
            tool("publish_recipe_import", "Publish a reviewed recipe ingestion.", props("ingestionId", "visibility"), required = listOf("ingestionId")),
            tool("get_meal_plan", "Get the household meal plan for a week.", props("week"), required = listOf("week"), readOnly = true),
            tool("add_recipe_to_plan", "Add a recipe to a meal plan.", props("week", "recipeId", "date", "slot", "servings"), required = listOf("week", "recipeId", "date", "slot", "servings")),
            tool("update_meal_plan_servings", "Update servings for a meal-plan item.", props("itemId", "servings"), required = listOf("itemId", "servings")),
            tool("copy_previous_meal_plan", "Copy the previous week into an empty target week.", props("targetWeek"), required = listOf("targetWeek")),
            tool("generate_shopping_list", "Generate a shopping list from a meal plan.", props("planId", "measurementSystem"), required = listOf("planId")),
            tool("get_shopping_list", "Get a shopping list by ID or the latest list.", props("listId"), readOnly = true),
            tool("create_shopping_list_link", "Create a public shopping-list link.", props("listId", "expiresInDays"), required = listOf("listId")),
            tool("revoke_shopping_list_link", "Revoke a public shopping-list link.", props("listId", "shareId"), required = listOf("listId", "shareId"), destructive = true),
            tool("email_shopping_list", "Queue a shopping-list email to the current user.", props("listId", "expiresInDays"), required = listOf("listId")),
        )

    fun call(name: String, args: Map<String, Any?>, principal: TableplanPrincipal): Any? {
        requireScope(principal, scopeFor(name))
        val access = RecipeAccess(principal.userId, principal.householdId)
        return when (name) {
            "search_recipes" ->
                recipes.search(
                    RecipeSearchNormalizer.normalize(
                        args.stringOrNull("query"),
                        args.stringOrNull("ingredient"),
                        args.stringList("tags"),
                        args.stringOrNull("tagMatch"),
                        args.stringOrNull("scope"),
                        args.intOrNull("limit"),
                        args.intOrNull("offset"),
                    ),
                    access,
                )
            "list_saved_searches" -> tenants.listSavedSearches(principal)
            "save_recipe_search" ->
                tenants.saveSearch(
                    principal,
                    args.requiredString("name"),
                    args.stringOrNull("query"),
                    args.stringOrNull("ingredient"),
                    args.stringList("tags"),
                    args.stringOrNull("tagMatch"),
                    args.stringOrNull("scope"),
                )
            "delete_saved_search" -> mapOf("deleted" to run { tenants.deleteSavedSearch(principal, args.requiredString("id")); true })
            "get_recipe" ->
                recipes.findById(args.requiredString("recipeId"), access)
                    ?: throw ApiException(404, "recipe_not_found", "Recipe not found.")
            "import_recipe_text" ->
                ingestions.create(
                    principal,
                    args.requiredString("text").toByteArray(),
                    args.stringOrNull("filename"),
                    "text/plain",
                    "paste",
                )
            "get_recipe_import" ->
                ingestions.get(principal, args.requiredString("ingestionId"))
                    ?: throw ApiException(404, "ingestion_not_found", "Recipe ingestion not found.")
            "publish_recipe_import" ->
                mapOf(
                    "recipeId" to
                        ingestions.publish(
                            principal,
                            args.requiredString("ingestionId"),
                            args.stringOrNull("visibility") ?: "user_private",
                            null,
                            emptyList(),
                        ),
                )
            "get_meal_plan" -> plans.getWeek(principal, args.requiredString("week"))
            "add_recipe_to_plan" ->
                plans.addItem(
                    principal,
                    args.requiredString("week"),
                    args.requiredString("recipeId"),
                    args.requiredString("date"),
                    args.requiredString("slot"),
                    args.requiredDouble("servings"),
                    args.stringOrNull("notes"),
                )
            "update_meal_plan_servings" ->
                plans.updateServings(principal, args.requiredString("itemId"), args.requiredDouble("servings"))
            "copy_previous_meal_plan" -> plans.clonePrevious(principal, args.requiredString("targetWeek"))
            "generate_shopping_list" ->
                shopping.generate(
                    principal,
                    args.requiredString("planId"),
                    args.stringOrNull("measurementSystem") ?: "original",
                )
            "get_shopping_list" ->
                args.stringOrNull("listId")?.let { shopping.getById(principal, it) } ?: shopping.latest(principal)
            "create_shopping_list_link" ->
                shares.create(principal, args.requiredString("listId"), args.intOrNull("expiresInDays") ?: 14)
            "revoke_shopping_list_link" ->
                mapOf(
                    "revoked" to
                        shares.revoke(
                            principal,
                            args.requiredString("listId"),
                            args.requiredString("shareId"),
                        ),
                )
            "email_shopping_list" ->
                email.create(principal, args.requiredString("listId"), args.intOrNull("expiresInDays") ?: 14)
            else -> throw McpFailure(-32602, "Unknown tool: $name")
        }
    }

    private fun requireScope(principal: TableplanPrincipal, scope: String) {
        if (principal.authenticationKind == AuthenticationKind.API_KEY && scope !in principal.scopes) {
            throw ApiException(403, "api_key_scope_denied", "The API key does not grant $scope.")
        }
    }

    private fun scopeFor(name: String) =
        when (name) {
            "search_recipes", "get_recipe", "list_saved_searches" -> "recipes:read"
            "save_recipe_search", "delete_saved_search", "import_recipe_text", "get_recipe_import", "publish_recipe_import" -> "recipes:write"
            "get_meal_plan" -> "plans:read"
            "add_recipe_to_plan", "update_meal_plan_servings", "copy_previous_meal_plan" -> "plans:write"
            "get_shopping_list" -> "shopping:read"
            else -> "shopping:write"
        }

    private fun tool(
        name: String,
        description: String,
        properties: Map<String, Any>,
        required: List<String> = emptyList(),
        readOnly: Boolean = false,
        destructive: Boolean = false,
    ) = McpTool(
        name,
        description,
        mapOf("type" to "object", "properties" to properties, "required" to required, "additionalProperties" to false),
        mapOf("readOnlyHint" to readOnly, "destructiveHint" to destructive, "idempotentHint" to readOnly),
    )

    private fun props(vararg names: String): Map<String, Any> =
        names.associateWith { name ->
            when (name) {
                "limit", "offset", "expiresInDays" -> mapOf("type" to "integer")
                "servings" -> mapOf("type" to "number")
                else -> mapOf("type" to "string")
            }
        }

    private fun Map<String, Any?>.requiredString(name: String): String =
        stringOrNull(name)?.takeIf(String::isNotBlank) ?: throw McpFailure(-32602, "$name is required")

    private fun Map<String, Any?>.stringOrNull(name: String): String? = this[name] as? String
    private fun Map<String, Any?>.stringList(name: String): List<String> = (this[name] as? List<*>)?.mapNotNull { it as? String }.orEmpty()
    private fun Map<String, Any?>.intOrNull(name: String): Int? = (this[name] as? Number)?.toInt()
    private fun Map<String, Any?>.requiredDouble(name: String): Double =
        (this[name] as? Number)?.toDouble() ?: throw McpFailure(-32602, "$name is required")
}

class McpFailure(val rpcCode: Int, override val message: String) : RuntimeException(message)

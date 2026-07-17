---
name: meal-planner-mcp
description: Operate a connected Tableplan MCP server to discover recipes, inspect a household week, add selected recipes with servings, and create or retrieve combined shopping lists. Use when Tableplan tools are available in Claude, ChatGPT, Codex, or another MCP client.
---

# Tableplan MCP

Use the connected MCP tools for conversational meal planning. Read
`references/tool-contract.md` for tool inputs, scopes, and write behavior.

## Planning Workflow

1. Call `get_meal_plan` for the intended week before proposing changes.
2. Call `search_recipes` with the user's dish, dietary, or ingredient terms.
   Use exact `tags` with `tagMatch: "all"` to narrow or `"any"` to broaden.
3. Call `get_recipe` for candidates when ingredient quantities or steps affect
   the choice.
4. Present stable recipe IDs with names, servings, and relevant ingredients.
5. Resolve an explicit date, meal slot, and serving count.
6. Call `add_recipe_to_plan` only after the selection is unambiguous.
7. Re-read the plan when multiple changes have been made.
8. Call `generate_shopping_list` once the week is final, then
   `get_shopping_list` to present the combined result.

## Tool Discipline

- Do not guess recipe IDs, plan IDs, dates, or serving counts.
- Use ISO `YYYY-MM-DD` dates.
- Prefer one bounded search followed by detail reads over repeated broad
  searches.
- Use `list_saved_searches` when the user refers to a recurring filter. Save or
  delete a search only when that change is requested.
- Use `copy_previous_meal_plan` only for an empty target week. It preserves the
  relative weekday, slot, servings, notes, and leftovers.
- Treat ingredient parse-quality information as uncertainty. Preserve the raw
  ingredient line when normalized quantity data is incomplete.
- Do not claim that incompatible units were combined.
- Report tool authorization failures without requesting credentials in chat.

## Write Confirmation

`save_recipe_search`, `delete_saved_search`, `add_recipe_to_plan`,
`copy_previous_meal_plan`, and `generate_shopping_list` write household data. Confirm
when the user has not already supplied the complete action. Generating a new
shopping list creates a snapshot; it does not silently modify the meal plan.

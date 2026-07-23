package com.tableplan.ingestion

data class RecipeDraft(
    val title: String,
    val description: String = "",
    val servings: Double? = null,
    val servingSize: String? = null,
    val ingredients: List<String>,
    val steps: List<String>,
    val tags: List<String> = emptyList(),
    val warnings: List<String> = emptyList(),
) {
    fun validated(): RecipeDraft {
        require(title.trim().isNotEmpty() && title.length <= 240) { "recipe_title_invalid" }
        require(description.length <= 4_000) { "recipe_description_too_long" }
        require(servings == null || servings in 0.25..1_000.0) { "recipe_servings_invalid" }
        require(ingredients.size <= 250 && ingredients.all { it.isNotBlank() && it.length <= 1_000 }) {
            "recipe_ingredients_invalid"
        }
        require(steps.size <= 250 && steps.all { it.isNotBlank() && it.length <= 5_000 }) {
            "recipe_steps_invalid"
        }
        require(tags.size <= 30 && tags.all { it.isNotBlank() && it.length <= 100 }) { "recipe_tags_invalid" }
        return copy(
            title = title.trim(),
            description = description.trim(),
            ingredients = ingredients.map(String::trim),
            steps = steps.map(String::trim),
            tags = tags.map(String::trim).distinct(),
        )
    }
}


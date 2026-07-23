package com.tableplan.ingestion

import org.springframework.stereotype.Component

interface RecipeExtractor {
    fun extract(source: String): RecipeDraft
}

@Component
class DeterministicRecipeExtractor : RecipeExtractor {
    override fun extract(source: String): RecipeDraft {
        val lines = source.lines().map(String::trim)
        val title = lines.firstOrNull { it.isNotEmpty() } ?: "Imported recipe"
        val ingredientHeading = lines.indexOfFirst { it.equals("ingredients", ignoreCase = true) }
        val methodHeading =
            lines.indexOfFirst {
                it.equals("method", ignoreCase = true) ||
                    it.equals("instructions", ignoreCase = true) ||
                    it.equals("directions", ignoreCase = true)
            }
        val ingredients =
            if (ingredientHeading >= 0) {
                lines.subList(
                    ingredientHeading + 1,
                    if (methodHeading > ingredientHeading) methodHeading else lines.size,
                ).filter(String::isNotEmpty).map { it.removePrefix("-").removePrefix("*").trim() }
            } else {
                emptyList()
            }
        val steps =
            if (methodHeading >= 0) {
                lines.drop(methodHeading + 1)
                    .filter(String::isNotEmpty)
                    .map { it.replace(Regex("^\\d+[.)]\\s*"), "").removePrefix("-").trim() }
            } else {
                emptyList()
            }
        return RecipeDraft(
            title = title.removePrefix("#").trim().take(240),
            ingredients = ingredients,
            steps = steps,
            warnings =
                buildList {
                    if (ingredients.isEmpty()) add("No ingredient section was detected.")
                    if (steps.isEmpty()) add("No method section was detected.")
                },
        ).validated()
    }
}

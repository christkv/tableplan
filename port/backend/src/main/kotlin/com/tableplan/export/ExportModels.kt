package com.tableplan.export

data class RecipePdfModel(
    val title: String,
    val description: String,
    val servings: Double?,
    val measurementSystem: String,
    val tags: List<String>,
    val ingredients: List<PdfIngredient>,
    val steps: List<String>,
)

data class PdfIngredient(
    val text: String,
    val unresolved: Boolean,
)

data class MealPlanPdfModel(
    val title: String,
    val startsOn: String,
    val endsOn: String,
    val slots: List<PdfMealSlot>,
    val days: List<PdfPlanDay>,
)

data class PdfMealSlot(
    val id: String,
    val label: String,
)

data class PdfPlanDay(
    val date: String,
    val label: String,
    val meals: List<PdfMeal>,
)

data class PdfMeal(
    val slotId: String,
    val recipeName: String,
    val servings: Double,
    val notes: String?,
)

data class ShoppingListPdfModel(
    val title: String,
    val startsOn: String?,
    val endsOn: String?,
    val measurementSystem: String,
    val items: List<PdfShoppingItem>,
)

data class PdfShoppingItem(
    val name: String,
    val quantity: String,
    val checked: Boolean,
    val unresolved: Boolean,
    val sources: List<String>,
)

data class CombinedPdfModel(
    val plan: MealPlanPdfModel,
    val shoppingList: ShoppingListPdfModel,
)

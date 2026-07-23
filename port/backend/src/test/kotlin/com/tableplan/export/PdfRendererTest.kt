package com.tableplan.export

import org.apache.pdfbox.Loader
import org.apache.pdfbox.text.PDFTextStripper
import java.nio.file.Files
import java.nio.file.Path
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PdfRendererTest {
    private val renderer = PdfRenderer(Clock.fixed(Instant.parse("2026-07-23T12:00:00Z"), ZoneOffset.UTC))

    @Test
    fun `renders bounded PDF documents`() {
        val bytes = renderer.render(listOf("Weekly plan", "• 2 cups tomatoes", "☐ bread"), "a4")
        assertTrue(bytes.size > 100)
        assertTrue(bytes.copyOfRange(0, 5).decodeToString() == "%PDF-")
    }

    @Test
    fun `renders structured export samples with searchable text`() {
        val recipe =
            RecipePdfModel(
                title = "Summer tomato, basil and burrata pasta",
                description =
                    "A bright weeknight pasta with jammy tomatoes, torn basil and creamy burrata. " +
                        "The sauce comes together while the pasta cooks.",
                servings = 4.0,
                measurementSystem = "metric",
                tags = listOf("Italian", "Vegetarian", "Weeknight", "Under 30 minutes", "Summer"),
                ingredients =
                    listOf(
                        PdfIngredient("400 g spaghetti", false),
                        PdfIngredient("600 g ripe cherry tomatoes, halved", false),
                        PdfIngredient("30 ml extra-virgin olive oil", false),
                        PdfIngredient("3 clove garlic, finely sliced", false),
                        PdfIngredient("1 tsp chilli flakes", false),
                        PdfIngredient("200 g burrata", false),
                        PdfIngredient("1 handful fresh basil leaves", true),
                        PdfIngredient("Sea salt and freshly ground black pepper", true),
                    ),
                steps =
                    listOf(
                        "Bring a large pan of well-salted water to a rolling boil. Cook the spaghetti until just al dente.",
                        "Warm the olive oil in a wide pan. Add the garlic and chilli flakes, then cook gently until fragrant.",
                        "Add the tomatoes and a generous pinch of salt. Cook until the tomatoes collapse into a glossy sauce.",
                        "Transfer the pasta to the sauce with a splash of cooking water and toss until every strand is coated.",
                        "Fold through most of the basil. Divide between warm bowls and finish with torn burrata and black pepper.",
                    ),
            )
        val slots =
            listOf(
                PdfMealSlot("breakfast", "Breakfast"),
                PdfMealSlot("lunch", "Lunch"),
                PdfMealSlot("dinner", "Dinner"),
                PdfMealSlot("snack", "Snack"),
            )
        val mealNames =
            listOf(
                "Blueberry overnight oats",
                "Roasted vegetable grain bowls",
                "Summer tomato and burrata pasta",
                "Miso glazed salmon with sesame greens",
                "Crispy chickpea Caesar salad",
                "Herby roast chicken and potatoes",
                "Courgette, lemon and ricotta tart",
            )
        val days =
            (0..6).map { index ->
                PdfPlanDay(
                    date = "2026-07-${20 + index}",
                    label = listOf("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")[index] +
                        ", Jul ${20 + index}",
                    meals =
                        listOf(
                            PdfMeal("breakfast", if (index % 2 == 0) "Blueberry overnight oats" else "Sourdough and soft eggs", 2.0, null),
                            PdfMeal("dinner", mealNames[index], 4.0, if (index == 4) "Use the garden lettuce" else null),
                        ) + if (index in 1..3) listOf(PdfMeal("lunch", "Leftovers and crunchy green salad", 2.0, null)) else emptyList(),
                )
            }
        val plan =
            MealPlanPdfModel(
                title = "A colourful week at home",
                startsOn = "2026-07-20",
                endsOn = "2026-07-26",
                slots = slots,
                days = days,
            )
        val shopping =
            ShoppingListPdfModel(
                title = "Shopping for a colourful week at home",
                startsOn = "2026-07-20",
                endsOn = "2026-07-26",
                measurementSystem = "metric",
                items =
                    listOf(
                        PdfShoppingItem("Cherry tomatoes", "1.2 kg", false, false, listOf("Summer tomato and burrata pasta")),
                        PdfShoppingItem("Extra-virgin olive oil", "90 ml", true, false, listOf("Summer tomato and burrata pasta", "Crispy chickpea Caesar salad")),
                        PdfShoppingItem("Fresh basil leaves", "", false, true, listOf("Summer tomato and burrata pasta")),
                        PdfShoppingItem("Spaghetti", "400 g", false, false, listOf("Summer tomato and burrata pasta")),
                        PdfShoppingItem("Burrata", "200 g", false, false, listOf("Summer tomato and burrata pasta")),
                        PdfShoppingItem("Salmon fillets", "680 g", false, false, listOf("Miso glazed salmon with sesame greens")),
                        PdfShoppingItem("White miso paste", "45 ml", false, false, listOf("Miso glazed salmon with sesame greens")),
                        PdfShoppingItem("Tenderstem broccoli", "450 g", false, false, listOf("Miso glazed salmon with sesame greens")),
                        PdfShoppingItem("Rolled oats", "240 g", true, false, listOf("Blueberry overnight oats")),
                        PdfShoppingItem("Blueberries", "300 g", false, false, listOf("Blueberry overnight oats")),
                        PdfShoppingItem("Greek yoghurt", "500 g", false, false, listOf("Blueberry overnight oats", "Herby roast chicken and potatoes")),
                        PdfShoppingItem("Whole chicken", "1.8 kg", false, false, listOf("Herby roast chicken and potatoes")),
                        PdfShoppingItem("Floury potatoes", "1.5 kg", false, false, listOf("Herby roast chicken and potatoes")),
                        PdfShoppingItem("Unwaxed lemons", "4", false, false, listOf("Herby roast chicken and potatoes", "Courgette, lemon and ricotta tart")),
                    ),
            )

        val samples =
            mapOf(
                "recipe.pdf" to renderer.render(recipe, "a4"),
                "plan.pdf" to renderer.render(plan, "a4"),
                "shopping.pdf" to renderer.render(shopping, "a4"),
                "combined.pdf" to renderer.render(CombinedPdfModel(plan, shopping), "a4"),
            )
        val output = Path.of("build", "pdf-samples")
        Files.createDirectories(output)
        samples.forEach { (name, bytes) ->
            Files.write(output.resolve(name), bytes)
            Loader.loadPDF(bytes).use { document ->
                assertTrue(document.numberOfPages >= 1)
                val text = PDFTextStripper().getText(document)
                assertTrue(text.contains("Generated by Tableplan on 2026-07-23"))
            }
        }
        Loader.loadPDF(samples.getValue("combined.pdf")).use {
            assertEquals(2, it.numberOfPages)
            val text = PDFTextStripper().getText(it)
            assertTrue(text.contains(plan.title))
            assertTrue(text.contains(shopping.title))
        }
    }
}

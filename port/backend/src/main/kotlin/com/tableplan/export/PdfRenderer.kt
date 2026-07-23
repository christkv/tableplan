package com.tableplan.export

import org.apache.pdfbox.pdmodel.PDDocument
import org.apache.pdfbox.pdmodel.PDPage
import org.apache.pdfbox.pdmodel.PDPageContentStream
import org.apache.pdfbox.pdmodel.common.PDRectangle
import org.apache.pdfbox.pdmodel.font.PDFont
import org.apache.pdfbox.pdmodel.font.PDType1Font
import org.apache.pdfbox.pdmodel.font.Standard14Fonts
import org.springframework.stereotype.Component
import java.awt.Color
import java.io.ByteArrayOutputStream
import java.time.Clock
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max

@Component
class PdfRenderer(
    private val clock: Clock,
) {
    private val regular = PDType1Font(Standard14Fonts.FontName.HELVETICA)
    private val bold = PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD)
    private val ink = Color(23, 32, 27)
    private val muted = Color(88, 100, 93)
    private val border = Color(205, 213, 208)
    private val lightBorder = Color(223, 228, 224)
    private val soft = Color(237, 242, 238)
    private val meal = Color(227, 240, 232)
    private val accent = Color(23, 107, 77)
    private val warning = Color(156, 91, 20)
    private val generatedOn: String
        get() = LocalDate.now(clock).toString()

    fun render(model: RecipePdfModel, paper: String): ByteArray =
        document { document -> renderRecipe(document, model, pageSize(paper, landscape = false)) }

    fun render(model: MealPlanPdfModel, paper: String): ByteArray =
        document { document -> renderPlan(document, model, pageSize(paper, landscape = true)) }

    fun render(model: ShoppingListPdfModel, paper: String): ByteArray =
        document { document -> renderShopping(document, model, pageSize(paper, landscape = false)) }

    fun render(model: CombinedPdfModel, paper: String): ByteArray =
        document { document ->
            val size = pageSize(paper, landscape = true)
            renderPlan(document, model.plan, size)
            renderShopping(document, model.shoppingList, size)
        }

    /**
     * Kept for small operational documents and compatibility with existing callers.
     * Product exports use the structured model overloads above.
     */
    fun render(input: List<String>, paper: String): ByteArray =
        document { document ->
            val size = pageSize(paper, landscape = false)
            var canvas = newPage(document, size)
            var y = size.height - 54f
            input.take(10_000).forEachIndexed { index, value ->
                val font = if (index == 0) bold else regular
                val sizeInPoints = if (index == 0) 22f else 10f
                val lines = wrap(value, font, sizeInPoints, size.width - 84f)
                val height = max(16f, lines.size * (sizeInPoints + 3f))
                if (y - height < 42f) {
                    footer(canvas, document.numberOfPages)
                    canvas.close()
                    canvas = newPage(document, size)
                    y = size.height - 54f
                }
                lines.forEach { line ->
                    text(canvas, line, 42f, y, font, sizeInPoints, if (index == 0) ink else muted)
                    y -= sizeInPoints + 3f
                }
                y -= if (index == 0) 10f else 3f
            }
            footer(canvas, document.numberOfPages)
            canvas.close()
        }

    private fun renderRecipe(document: PDDocument, model: RecipePdfModel, size: PDRectangle) {
        val margin = 42f
        val bottom = 40f
        var ingredientIndex = 0
        var stepIndex = 0
        var firstPage = true
        do {
            val canvas = newPage(document, size)
            var top =
                if (firstPage) {
                    recipeHeader(canvas, model, size, margin)
                } else {
                    text(canvas, "${model.title} (continued)", margin, size.height - margin, bold, 14f, ink)
                    size.height - margin - 25f
                }
            if (top < bottom + 80f) top = size.height - margin

            val gap = 28f
            val availableWidth = size.width - margin * 2
            val ingredientWidth = availableWidth * .38f
            val methodWidth = availableWidth - ingredientWidth - gap
            val methodX = margin + ingredientWidth + gap
            text(canvas, "Ingredients", margin, top, bold, 14f, ink)
            text(canvas, "Method", methodX, top, bold, 14f, ink)
            var leftY = top - 22f
            var rightY = top - 22f

            if (model.ingredients.isEmpty() && ingredientIndex == 0) {
                text(canvas, "No ingredients listed.", margin, leftY, regular, 9f, muted)
                ingredientIndex = 1
            }
            while (ingredientIndex < model.ingredients.size) {
                val item = model.ingredients[ingredientIndex]
                val lines = wrap(item.text, regular, 9f, ingredientWidth - 4f)
                val height = max(24f, lines.size * 12f + 8f)
                if (leftY - height < bottom) break
                var lineY = leftY - 11f
                lines.forEach { line ->
                    text(canvas, line, margin, lineY, regular, 9f, ink)
                    lineY -= 12f
                }
                if (item.unresolved) {
                    text(canvas, "*", margin + ingredientWidth - 8f, leftY - 11f, bold, 9f, warning)
                }
                line(canvas, margin, leftY - height, margin + ingredientWidth, leftY - height, lightBorder, .55f)
                leftY -= height
                ingredientIndex++
            }

            if (model.steps.isEmpty() && stepIndex == 0) {
                text(canvas, "No method steps listed.", methodX, rightY, regular, 9f, muted)
                stepIndex = 1
            }
            while (stepIndex < model.steps.size) {
                val numberWidth = 20f
                val lines = wrap(model.steps[stepIndex], regular, 9f, methodWidth - numberWidth)
                val height = max(24f, lines.size * 12f + 8f)
                if (rightY - height < bottom) break
                text(canvas, "${stepIndex + 1}.", methodX, rightY - 11f, bold, 9f, accent)
                var lineY = rightY - 11f
                lines.forEach { line ->
                    text(canvas, line, methodX + numberWidth, lineY, regular, 9f, ink)
                    lineY -= 12f
                }
                rightY -= height
                stepIndex++
            }
            footer(canvas, document.numberOfPages)
            canvas.close()
            firstPage = false
        } while (ingredientIndex < model.ingredients.size || stepIndex < model.steps.size)
    }

    private fun recipeHeader(
        canvas: Canvas,
        model: RecipePdfModel,
        size: PDRectangle,
        margin: Float,
    ): Float {
        var y = size.height - margin
        val titleLines = wrap(model.title, bold, 23f, size.width - margin * 2).take(3)
        titleLines.forEach {
            text(canvas, it, margin, y, bold, 23f, ink)
            y -= 25f
        }
        y -= 5f
        val servings = model.servings?.let { "${number(it)} servings" } ?: "Yield not specified"
        text(canvas, "$servings  |  ${measurementLabel(model.measurementSystem)}", margin, y, regular, 10f, muted)
        y -= 21f
        if (model.description.isNotBlank()) {
            val descriptionLines = wrap(model.description, regular, 9.5f, size.width - margin * 2).take(10)
            descriptionLines.forEach {
                text(canvas, it, margin, y, regular, 9.5f, ink)
                y -= 13f
            }
            y -= 7f
        }
        if (model.tags.isNotEmpty()) {
            val visibleTags =
                model.tags.take(24).let {
                    if (model.tags.size > it.size) it + "+${model.tags.size - it.size} more" else it
                }
            var x = margin
            visibleTags.forEach { tag ->
                val width = minOf(textWidth(tag, regular, 7.5f) + 13f, size.width - margin * 2)
                if (x + width > size.width - margin) {
                    x = margin
                    y -= 19f
                }
                rect(canvas, x, y - 11f, width, 16f, fill = null, stroke = border, lineWidth = .65f)
                text(canvas, tag, x + 6f, y - 6f, regular, 7.5f, muted)
                x += width + 6f
            }
            y -= 23f
        }
        return y
    }

    private fun renderPlan(document: PDDocument, model: MealPlanPdfModel, size: PDRectangle) {
        val margin = 28f
        val bottom = 40f
        val tableWidth = size.width - margin * 2
        val slotWidth = 69f
        val dayWidth = (tableWidth - slotWidth) / 7f
        var slotIndex = 0
        var pageCount = 0
        do {
            val canvas = newPage(document, size)
            var rowsOnPage = 0
            var y = size.height - 34f
            text(canvas, model.title, margin, y, bold, 22f, ink)
            y -= 24f
            text(canvas, "${model.startsOn} to ${model.endsOn}", margin, y, regular, 9.5f, muted)
            y -= 21f
            val headerHeight = 34f
            tableCell(canvas, margin, y - headerHeight, slotWidth, headerHeight, soft)
            text(canvas, "Meal", margin + 7f, y - 20f, bold, 8f, ink)
            model.days.take(7).forEachIndexed { index, day ->
                val x = margin + slotWidth + dayWidth * index
                tableCell(canvas, x, y - headerHeight, dayWidth, headerHeight, soft)
                val lines = wrap(day.label, bold, 7.5f, dayWidth - 10f).take(2)
                lines.forEachIndexed { lineIndex, label ->
                    text(canvas, label, x + 5f, y - 14f - lineIndex * 9f, bold, 7.5f, ink)
                }
            }
            y -= headerHeight
            if (model.slots.isEmpty()) {
                tableCell(canvas, margin, y - 44f, tableWidth, 44f, Color.WHITE)
                text(canvas, "No meal sections configured.", margin + 8f, y - 25f, regular, 9f, muted)
                y -= 44f
                slotIndex = 1
            }
            while (slotIndex < model.slots.size) {
                val slot = model.slots[slotIndex]
                val mealsByDay = model.days.take(7).map { day -> day.meals.filter { it.slotId == slot.id } }
                val rowHeight =
                    max(
                        44f,
                        mealsByDay.maxOfOrNull { meals ->
                            meals.sumOf { pdfMealHeight(it, dayWidth - 10f).toDouble() }.toFloat() + 8f
                        } ?: 44f,
                    )
                if (y - rowHeight < bottom && rowsOnPage > 0) break
                tableCell(canvas, margin, y - rowHeight, slotWidth, rowHeight, Color.WHITE)
                wrap(slot.label, bold, 8.2f, slotWidth - 12f).take(3).forEachIndexed { index, label ->
                    text(canvas, label, margin + 6f, y - 16f - index * 10f, bold, 8.2f, ink)
                }
                mealsByDay.forEachIndexed { dayIndex, meals ->
                    val x = margin + slotWidth + dayWidth * dayIndex
                    tableCell(canvas, x, y - rowHeight, dayWidth, rowHeight, Color.WHITE)
                    var mealY = y - 5f
                    meals.forEach { entry ->
                        val height = pdfMealHeight(entry, dayWidth - 10f)
                        rect(canvas, x + 4f, mealY - height, dayWidth - 8f, height - 2f, meal, null)
                        val titleLines = wrap(entry.recipeName, bold, 7.5f, dayWidth - 16f).take(3)
                        titleLines.forEachIndexed { lineIndex, title ->
                            text(canvas, title, x + 8f, mealY - 11f - lineIndex * 9f, bold, 7.5f, ink)
                        }
                        val detail =
                            "${number(entry.servings)} servings" +
                                (entry.notes?.takeIf(String::isNotBlank)?.let { " | $it" } ?: "")
                        text(
                            canvas,
                            ellipsize(detail, regular, 6.6f, dayWidth - 16f),
                            x + 8f,
                            mealY - height + 8f,
                            regular,
                            6.6f,
                            muted,
                        )
                        mealY -= height
                    }
                }
                y -= rowHeight
                slotIndex++
                rowsOnPage++
            }
            pageCount++
            footer(canvas, document.numberOfPages)
            canvas.close()
        } while (slotIndex < model.slots.size && pageCount < 50)
    }

    private fun pdfMealHeight(entry: PdfMeal, width: Float): Float {
        val titleLines = wrap(entry.recipeName, bold, 7.5f, width - 6f).take(3).size
        return max(30f, titleLines * 9f + 17f)
    }

    private fun renderShopping(document: PDDocument, model: ShoppingListPdfModel, size: PDRectangle) {
        val margin = 38f
        val bottom = 40f
        val gap = 28f
        val columnWidth = (size.width - margin * 2 - gap) / 2f
        var itemIndex = 0
        var firstPage = true
        do {
            val canvas = newPage(document, size)
            var top = size.height - margin
            if (firstPage) {
                wrap(model.title, bold, 22f, size.width - margin * 2).take(2).forEach { title ->
                    text(canvas, title, margin, top, bold, 22f, ink)
                    top -= 24f
                }
                top -= 1f
                val dates =
                    if (model.startsOn != null && model.endsOn != null) {
                        "${model.startsOn} to ${model.endsOn}  |  "
                    } else {
                        ""
                    }
                text(
                    canvas,
                    "$dates${measurementLabel(model.measurementSystem)}  |  ${model.items.size} items",
                    margin,
                    top,
                    regular,
                    9.5f,
                    muted,
                )
                top -= 24f
            } else {
                text(canvas, "${model.title} (continued)", margin, top, bold, 14f, ink)
                top -= 25f
            }
            if (model.items.isEmpty() && itemIndex == 0) {
                text(canvas, "No shopping items.", margin, top - 15f, regular, 10f, muted)
                itemIndex = 1
            }
            val layout = shoppingPageLayout(model.items, itemIndex, columnWidth, top - bottom)
            layout.columns.forEachIndexed { column, indices ->
                val x = margin + column * (columnWidth + gap)
                var y = top
                indices.forEach { index ->
                    val item = model.items[index]
                    val height = shoppingItemHeight(item, columnWidth)
                    drawShoppingItem(canvas, item, x, y, columnWidth, height)
                    y -= height
                }
            }
            itemIndex += layout.itemCount
            footer(canvas, document.numberOfPages)
            canvas.close()
            firstPage = false
        } while (itemIndex < model.items.size)
    }

    private fun shoppingPageLayout(
        items: List<PdfShoppingItem>,
        startIndex: Int,
        columnWidth: Float,
        availableHeight: Float,
    ): ShoppingPageLayout {
        if (startIndex >= items.size) return ShoppingPageLayout(listOf(emptyList(), emptyList()), 0)
        val heights =
            items.drop(startIndex).take(200).map { shoppingItemHeight(it, columnWidth) }
        var acceptedCount = 0
        var acceptedSplit = 0
        for (count in 1..heights.size) {
            val prefix = heights.take(count)
            val candidates =
                (0..count).mapNotNull { split ->
                    val first = prefix.take(split).sum()
                    val second = prefix.drop(split).sum()
                    if (first <= availableHeight && second <= availableHeight) {
                        Triple(split, first, second)
                    } else {
                        null
                    }
                }
            val best = candidates.minByOrNull { kotlin.math.abs(it.second - it.third) } ?: break
            acceptedCount = count
            acceptedSplit = best.first
        }
        if (acceptedCount == 0) {
            acceptedCount = 1
            acceptedSplit = 1
        }
        val indices = (startIndex until startIndex + acceptedCount).toList()
        return ShoppingPageLayout(
            columns = listOf(indices.take(acceptedSplit), indices.drop(acceptedSplit)),
            itemCount = acceptedCount,
        )
    }

    private fun shoppingItemHeight(item: PdfShoppingItem, width: Float): Float {
        val quantityWidth = minOf(62f, max(30f, textWidth(item.quantity, bold, 8.5f) + 4f))
        val copyWidth = width - 24f - quantityWidth
        val titleLines = wrap(item.name + if (item.unresolved) " *" else "", bold, 8.8f, copyWidth).take(3).size
        val sourceLines =
            if (item.sources.isEmpty()) 0 else wrap(item.sources.distinct().joinToString(", "), regular, 7f, copyWidth).take(2).size
        return max(29f, 9f + titleLines * 11f + sourceLines * 8f)
    }

    private fun drawShoppingItem(
        canvas: Canvas,
        item: PdfShoppingItem,
        x: Float,
        top: Float,
        width: Float,
        height: Float,
    ) {
        val boxSize = 11f
        rect(canvas, x, top - 16f, boxSize, boxSize, if (item.checked) accent else null, muted, .8f)
        if (item.checked) {
            line(canvas, x + 2f, top - 11f, x + 4.5f, top - 13.5f, Color.WHITE, 1.1f)
            line(canvas, x + 4.5f, top - 13.5f, x + 9f, top - 7.5f, Color.WHITE, 1.1f)
        }
        val quantityWidth = minOf(62f, max(30f, textWidth(item.quantity, bold, 8.5f) + 4f))
        val copyX = x + 19f
        val copyWidth = width - 24f - quantityWidth
        val titleColor = if (item.checked) muted else ink
        val title = item.name + if (item.unresolved) " *" else ""
        val titleLines = wrap(title, bold, 8.8f, copyWidth).take(3)
        titleLines.forEachIndexed { index, value ->
            text(canvas, value, copyX, top - 10f - index * 11f, bold, 8.8f, titleColor)
            if (item.checked) {
                val lineY = top - 7f - index * 11f
                line(canvas, copyX, lineY, copyX + textWidth(value, bold, 8.8f), lineY, muted, .55f)
            }
        }
        if (item.sources.isNotEmpty()) {
            val sourceTop = top - 11f - titleLines.size * 11f
            wrap(item.sources.distinct().joinToString(", "), regular, 7f, copyWidth).take(2)
                .forEachIndexed { index, value ->
                    text(canvas, value, copyX, sourceTop - index * 8f, regular, 7f, muted)
                }
        }
        text(
            canvas,
            item.quantity,
            x + width - textWidth(item.quantity, bold, 8.5f),
            top - 10f,
            bold,
            8.5f,
            ink,
        )
        line(canvas, x, top - height, x + width, top - height, lightBorder, .55f)
    }

    private fun tableCell(
        canvas: Canvas,
        x: Float,
        y: Float,
        width: Float,
        height: Float,
        fill: Color,
    ) = rect(canvas, x, y, width, height, fill, border, .6f)

    private fun footer(canvas: Canvas, pageNumber: Int) {
        val width = canvas.page.mediaBox.width
        line(canvas, 30f, 28f, width - 30f, 28f, lightBorder, .45f)
        text(canvas, "Generated by Tableplan on $generatedOn", 30f, 16f, regular, 7f, muted)
        val page = "Page $pageNumber"
        text(canvas, page, width - 30f - textWidth(page, regular, 7f), 16f, regular, 7f, muted)
    }

    private fun document(render: (PDDocument) -> Unit): ByteArray {
        PDDocument().use { document ->
            render(document)
            val output = ByteArrayOutputStream()
            document.save(output)
            return output.toByteArray()
        }
    }

    private fun pageSize(paper: String, landscape: Boolean): PDRectangle {
        val base = if (paper == "letter") PDRectangle.LETTER else PDRectangle.A4
        return if (landscape) PDRectangle(base.height, base.width) else base
    }

    private fun newPage(document: PDDocument, size: PDRectangle): Canvas {
        val page = PDPage(size)
        document.addPage(page)
        return Canvas(page, PDPageContentStream(document, page))
    }

    private fun text(
        canvas: Canvas,
        value: String,
        x: Float,
        y: Float,
        font: PDFont,
        size: Float,
        color: Color,
    ) {
        canvas.stream.beginText()
        canvas.stream.setFont(font, size)
        nonStroking(canvas.stream, color)
        canvas.stream.newLineAtOffset(x, y)
        canvas.stream.showText(printable(value))
        canvas.stream.endText()
    }

    private fun line(
        canvas: Canvas,
        x1: Float,
        y1: Float,
        x2: Float,
        y2: Float,
        color: Color,
        width: Float,
    ) {
        stroking(canvas.stream, color)
        canvas.stream.setLineWidth(width)
        canvas.stream.moveTo(x1, y1)
        canvas.stream.lineTo(x2, y2)
        canvas.stream.stroke()
    }

    private fun rect(
        canvas: Canvas,
        x: Float,
        y: Float,
        width: Float,
        height: Float,
        fill: Color?,
        stroke: Color?,
        lineWidth: Float = .5f,
    ) {
        canvas.stream.addRect(x, y, width, height)
        when {
            fill != null && stroke != null -> {
                nonStroking(canvas.stream, fill)
                stroking(canvas.stream, stroke)
                canvas.stream.setLineWidth(lineWidth)
                canvas.stream.fillAndStroke()
            }
            fill != null -> {
                nonStroking(canvas.stream, fill)
                canvas.stream.fill()
            }
            stroke != null -> {
                stroking(canvas.stream, stroke)
                canvas.stream.setLineWidth(lineWidth)
                canvas.stream.stroke()
            }
        }
    }

    private fun wrap(value: String, font: PDFont, size: Float, maxWidth: Float): List<String> {
        val normalized = printable(value).trim()
        if (normalized.isEmpty()) return listOf("")
        val lines = mutableListOf<String>()
        var current = ""
        normalized.split(Regex("\\s+")).forEach { sourceWord ->
            val words = splitLongWord(sourceWord, font, size, maxWidth)
            words.forEach { word ->
                val candidate = if (current.isEmpty()) word else "$current $word"
                if (textWidth(candidate, font, size) <= maxWidth) {
                    current = candidate
                } else {
                    if (current.isNotEmpty()) lines += current
                    current = word
                }
            }
        }
        if (current.isNotEmpty()) lines += current
        return lines.ifEmpty { listOf("") }
    }

    private fun splitLongWord(value: String, font: PDFont, size: Float, maxWidth: Float): List<String> {
        if (textWidth(value, font, size) <= maxWidth) return listOf(value)
        val result = mutableListOf<String>()
        var part = ""
        value.forEach { character ->
            val candidate = part + character
            if (part.isNotEmpty() && textWidth(candidate, font, size) > maxWidth) {
                result += part
                part = character.toString()
            } else {
                part = candidate
            }
        }
        if (part.isNotEmpty()) result += part
        return result
    }

    private fun ellipsize(value: String, font: PDFont, size: Float, maxWidth: Float): String {
        if (textWidth(value, font, size) <= maxWidth) return value
        var result = printable(value)
        while (result.isNotEmpty() && textWidth("$result...", font, size) > maxWidth) {
            result = result.dropLast(1)
        }
        return "$result..."
    }

    private fun textWidth(value: String, font: PDFont, size: Float): Float =
        font.getStringWidth(printable(value)) / 1000f * size

    private fun number(value: Double): String =
        java.math.BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()

    private fun measurementLabel(value: String): String =
        when (value) {
            "metric" -> "Metric (EU)"
            "us" -> "US customary"
            else -> "Original units"
        }

    private fun printable(value: String): String =
        value.replace("–", "-")
            .replace("—", "-")
            .replace("•", "*")
            .replace("☑", "[x]")
            .replace("☐", "[ ]")
            .map { if (it.code in 32..126 || it.code in 160..255) it else '?' }
            .joinToString("")

    private fun nonStroking(stream: PDPageContentStream, color: Color) =
        stream.setNonStrokingColor(color.red / 255f, color.green / 255f, color.blue / 255f)

    private fun stroking(stream: PDPageContentStream, color: Color) =
        stream.setStrokingColor(color.red / 255f, color.green / 255f, color.blue / 255f)

    private data class Canvas(
        val page: PDPage,
        val stream: PDPageContentStream,
    ) : AutoCloseable {
        override fun close() = stream.close()
    }

    private data class ShoppingPageLayout(
        val columns: List<List<Int>>,
        val itemCount: Int,
    )
}

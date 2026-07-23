package com.tableplan.export

import org.apache.pdfbox.pdmodel.PDDocument
import org.apache.pdfbox.pdmodel.PDPage
import org.apache.pdfbox.pdmodel.PDPageContentStream
import org.apache.pdfbox.pdmodel.common.PDRectangle
import org.apache.pdfbox.pdmodel.font.Standard14Fonts
import org.apache.pdfbox.pdmodel.font.PDType1Font
import org.springframework.stereotype.Component
import java.io.ByteArrayOutputStream

@Component
class PdfRenderer {
    fun render(input: List<String>, paper: String): ByteArray {
        val pageSize = if (paper == "letter") PDRectangle.LETTER else PDRectangle.A4
        val font = PDType1Font(Standard14Fonts.FontName.HELVETICA)
        val fontSize = 11f
        val margin = 48f
        val lineHeight = 16f
        val maxWidth = pageSize.width - margin * 2
        val lines = input.flatMap { wrap(printable(it), font, fontSize, maxWidth) }.take(10_000)
        PDDocument().use { document ->
            var page: PDPage? = null
            var stream: PDPageContentStream? = null
            var y = 0f
            fun nextPage() {
                stream?.endText()
                stream?.close()
                page = PDPage(pageSize)
                document.addPage(page)
                stream = PDPageContentStream(document, page)
                stream!!.beginText()
                stream!!.setFont(font, fontSize)
                stream!!.setLeading(lineHeight)
                stream!!.newLineAtOffset(margin, pageSize.height - margin)
                y = pageSize.height - margin
            }
            nextPage()
            lines.forEach { line ->
                if (y - lineHeight < margin) nextPage()
                stream!!.showText(line)
                stream!!.newLine()
                y -= lineHeight
            }
            stream?.endText()
            stream?.close()
            val output = ByteArrayOutputStream()
            document.save(output)
            return output.toByteArray()
        }
    }

    private fun wrap(value: String, font: PDType1Font, size: Float, maxWidth: Float): List<String> {
        if (value.isEmpty()) return listOf("")
        val result = mutableListOf<String>()
        var line = ""
        value.split(Regex("\\s+")).forEach { word ->
            val candidate = if (line.isEmpty()) word else "$line $word"
            if (font.getStringWidth(candidate) / 1000f * size <= maxWidth) {
                line = candidate
            } else {
                if (line.isNotEmpty()) result += line
                line = word.take(200)
            }
        }
        if (line.isNotEmpty()) result += line
        return result
    }

    private fun printable(value: String) =
        value.replace("–", "-").replace("—", "-").replace("•", "*")
            .replace("☑", "[x]").replace("☐", "[ ]")
            .map { if (it.code in 32..255) it else '?' }
            .joinToString("")
}

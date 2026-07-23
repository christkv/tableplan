package com.tableplan.export

import kotlin.test.Test
import kotlin.test.assertTrue

class PdfRendererTest {
    @Test
    fun `renders bounded PDF documents`() {
        val bytes = PdfRenderer().render(listOf("Weekly plan", "• 2 cups tomatoes", "☐ bread"), "a4")
        assertTrue(bytes.size > 100)
        assertTrue(bytes.copyOfRange(0, 5).decodeToString() == "%PDF-")
    }
}

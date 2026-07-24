package com.tableplan.email

import org.junit.jupiter.api.Test
import kotlin.test.assertContains
import kotlin.test.assertFalse

class BrandedEmailRendererTest {
    private val renderer = BrandedEmailRenderer()

    @Test
    fun `renders a responsive branded call to action with a plain text alternative`() {
        val email =
            renderer.render(
                BrandedEmailTemplate(
                    preheader = "A useful preview",
                    eyebrow = "Ready for the shop",
                    heading = "Your shopping list is ready",
                    paragraphs = listOf("Everything is gathered into one checklist."),
                    actionLabel = "Open shopping list",
                    actionUrl = "https://www.tablerhythm.com/shared/shopping?shareId=one&token=two",
                    note = "Keep this private.",
                ),
            )

        assertContains(email.html, "<!doctype html>")
        assertContains(email.html, "@media only screen and (max-width: 620px)")
        assertContains(email.html, "@media (prefers-color-scheme: dark)")
        assertContains(email.html, "background-color:#344232")
        assertContains(email.html, "background-color:#b95232")
        assertContains(email.html, "Table Rhythm")
        assertContains(email.html, "Alpha")
        assertContains(
            email.html,
            "href=\"https://www.tablerhythm.com/shared/shopping?shareId=one&amp;token=two\"",
        )
        assertContains(email.text, "Open shopping list: https://www.tablerhythm.com/shared/shopping?shareId=one&token=two")
    }

    @Test
    fun `escapes every dynamic value in html`() {
        val email =
            renderer.render(
                BrandedEmailTemplate(
                    preheader = "<preview>",
                    eyebrow = "\"Welcome\"",
                    heading = "<script>alert('heading')</script>",
                    paragraphs = listOf("Hello <b>friend</b> & family"),
                    actionLabel = "Open >",
                    actionUrl = "https://example.com/?value=\"unsafe\"&other=<tag>",
                    note = "Don't share <this>.",
                ),
            )

        assertFalse(email.html.contains("<script>"))
        assertFalse(email.html.contains("<b>friend</b>"))
        assertContains(email.html, "&lt;script&gt;alert(&#39;heading&#39;)&lt;/script&gt;")
        assertContains(email.html, "Hello &lt;b&gt;friend&lt;/b&gt; &amp; family")
        assertContains(email.html, "value=&quot;unsafe&quot;&amp;other=&lt;tag&gt;")
        assertContains(email.text, "<script>alert('heading')</script>")
    }

    @Test
    fun `renders the full checklist in html and plain text`() {
        val email =
            renderer.render(
                BrandedEmailTemplate(
                    preheader = "Shopping is ready",
                    eyebrow = "Ready for the shop",
                    heading = "Your shopping list",
                    paragraphs = listOf("Take this list with you."),
                    actionLabel = "Open live list",
                    actionUrl = "https://www.tablerhythm.com/shared/shopping",
                    note = "Keep the link private.",
                    checklist =
                        BrandedEmailChecklist(
                            title = "Shopping for <Friday>",
                            summary = "1 left · 2 total",
                            items =
                                listOf(
                                    BrandedEmailChecklistItem(
                                        name = "Milk & cream",
                                        quantity = "2 L",
                                        checked = false,
                                        detail = "From: Pancakes",
                                    ),
                                    BrandedEmailChecklistItem(
                                        name = "Eggs",
                                        quantity = "6",
                                        checked = true,
                                    ),
                                ),
                        ),
                ),
            )

        assertContains(email.html, "Shopping for &lt;Friday&gt;")
        assertContains(email.html, "Milk &amp; cream")
        assertContains(email.html, "From: Pancakes")
        assertContains(email.html, "&#9633;")
        assertContains(email.html, "&#10003;")
        assertContains(email.text, "[ ] 2 L · Milk & cream")
        assertContains(email.text, "[x] 6 · Eggs")
        assertContains(email.text, "Open live list: https://www.tablerhythm.com/shared/shopping")
    }
}

package com.tableplan.email

import com.mongodb.MongoClientSettings
import com.tableplan.shopping.ShoppingItem
import com.tableplan.shopping.ShoppingList
import com.tableplan.shopping.ShoppingSource
import org.bson.Document
import org.junit.jupiter.api.Test
import java.time.Instant
import kotlin.test.assertContains
import kotlin.test.assertEquals

class EmailDeliveryRecoveryTest {
    @Test
    fun `maps a shopping list to quantities states and useful source details`() {
        val checklist =
            ShoppingList(
                id = "list-1",
                name = "Shopping for Week 30",
                measurementSystem = "metric",
                generatedAt = Instant.parse("2026-07-24T12:00:00Z"),
                updatedAt = Instant.parse("2026-07-24T12:30:00Z"),
                version = 2,
                plan = null,
                items =
                    listOf(
                        ShoppingItem(
                            id = "item-1",
                            name = "Flour",
                            quantityMin = "1.23456",
                            quantityMax = "2",
                            unitId = "kg",
                            checked = false,
                            unresolved = false,
                            sources =
                                listOf(
                                    ShoppingSource("recipe-1", "Bread", "1 kg flour"),
                                    ShoppingSource("recipe-2", "Cake", "200 g flour"),
                                ),
                        ),
                        ShoppingItem(
                            id = "item-2",
                            name = "Herbs",
                            quantityMin = null,
                            quantityMax = null,
                            unitId = null,
                            checked = true,
                            unresolved = true,
                            sources = listOf(ShoppingSource("recipe-3", "Soup", "a handful of herbs")),
                        ),
                    ),
            ).toEmailChecklist()

        assertEquals("Shopping for Week 30", checklist.title)
        assertEquals("1 left · 2 total", checklist.summary)
        assertEquals("1.235–2 kg", checklist.items[0].quantity)
        assertEquals("From: Bread, Cake", checklist.items[0].detail)
        assertEquals("", checklist.items[1].quantity)
        assertEquals("Original: a handful of herbs", checklist.items[1].detail)
        assertEquals(true, checklist.items[1].checked)
    }

    @Test
    fun `records safe Cloudflare failure codes`() {
        assertEquals(
            "email_send_failed:cloudflare_email_http_403_cf_10102",
            emailDeliveryFailureCode(
                CloudflareEmailException(
                    code = "cloudflare_email_http_403_cf_10102",
                    retryable = false,
                ),
            ),
        )
    }

    @Test
    fun `claim filter includes stale sending deliveries`() {
        val filter =
            emailDeliveryClaimFilter(
                "delivery-1",
                Instant.parse("2026-07-24T15:20:00Z"),
            ).toBsonDocument(Document::class.java, MongoClientSettings.getDefaultCodecRegistry())
                .toJson()

        assertContains(filter, "\"delivery-1\"")
        assertContains(filter, "\"queued\"")
        assertContains(filter, "\"failed\"")
        assertContains(filter, "\"sending\"")
        assertContains(filter, "\"updatedAt\"")
        assertContains(filter, "\$lte")
    }
}

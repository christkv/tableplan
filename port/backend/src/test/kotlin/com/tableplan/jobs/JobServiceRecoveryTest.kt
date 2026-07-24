package com.tableplan.jobs

import com.mongodb.MongoClientSettings
import org.bson.Document
import org.junit.jupiter.api.Test
import java.time.Instant
import kotlin.test.assertContains

class JobServiceRecoveryTest {
    @Test
    fun `claim filter includes running jobs with expired leases`() {
        val filter =
            jobClaimFilter(
                Instant.parse("2026-07-24T15:20:00Z"),
            ).toBsonDocument(Document::class.java, MongoClientSettings.getDefaultCodecRegistry())
                .toJson()

        assertContains(filter, "\"queued\"")
        assertContains(filter, "\"retry\"")
        assertContains(filter, "\"running\"")
        assertContains(filter, "\"leaseExpiresAt\"")
        assertContains(filter, "\$lte")
    }
}

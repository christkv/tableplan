package com.tableplan.odm

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import java.time.Instant

class DocumentMapperTest {
    @MongoDocument("examples")
    class Example : StringIdDocument() {
        @Field("persisted_name")
        var displayName: String? = null

        @Field
        var createdAt: Instant? = null
    }

    private val mapper = DocumentMapper()

    @Test
    fun `field names and instants round trip symmetrically`() {
        val source = Example().apply {
            id = "3e13f8d4-5e8c-49a1-bc30-0f94c8d04012"
            displayName = "Dinner"
            createdAt = Instant.parse("2026-07-23T12:00:00Z")
        }

        val document = mapper.toDocument(source)
        assertEquals("Dinner", document["persisted_name"])
        assertEquals(source.id, document["_id"])

        val restored = mapper.fromDocument(document, Example::class)
        assertEquals(source.id, restored.id)
        assertEquals(source.displayName, restored.displayName)
        assertEquals(source.createdAt, restored.createdAt)
    }

    @Test
    fun `blank ids are rejected`() {
        assertFailsWith<IllegalStateException> { Example().requireValidId() }
    }
}


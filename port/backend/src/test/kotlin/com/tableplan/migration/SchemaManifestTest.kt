package com.tableplan.migration

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SchemaManifestTest {
    @Test
    fun `preserves all compatibility source collections`() {
        assertEquals(28, SchemaManifest.collections.count { it.applicationCollection })
    }

    @Test
    fun `every declared index has a stable name`() {
        assertTrue(
            SchemaManifest.collections
                .flatMap { it.indexes }
                .all { !it.options.name.isNullOrBlank() },
        )
    }
}


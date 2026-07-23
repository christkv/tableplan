package com.tableplan.migration

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
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

    @Test
    fun `retires the legacy raw session token index`() {
        val sessions = SchemaManifest.collections.single { it.name == "sessions" }

        assertEquals(setOf("session_token_unique"), sessions.obsoleteIndexes)
        assertTrue(sessions.indexes.none { it.options.name == "session_token_unique" })
    }

    @Test
    fun `recipe browse indexes cover stable name and id ordering`() {
        val recipes = SchemaManifest.collections.single { it.name == "recipes" }
        val browseIndexes =
            recipes.indexes.filter { it.options.name?.endsWith("_browse") == true }

        assertEquals(3, browseIndexes.size)
        assertTrue(
            browseIndexes.all {
                it.keys.toBsonDocument().keys.toList().takeLast(2) == listOf("name", "_id")
            },
        )
    }

    @Test
    fun `recipe search index maps stable sort strings as tokens`() {
        val searchIndex = SchemaManifest.searchIndexes.single { it.name == "recipes_v1" }
        val fields =
            searchIndex.definition
                .get("mappings", org.bson.Document::class.java)
                .get("fields", org.bson.Document::class.java)

        assertEquals(setOf("name", "_id"), searchIndex.requiredSortableTokenFields)
        searchIndex.requiredSortableTokenFields.forEach { field ->
            val mappings =
                when (val mapping = fields[field]) {
                    is org.bson.Document -> listOf(mapping)
                    is List<*> -> mapping.filterIsInstance<org.bson.Document>()
                    else -> emptyList()
                }
            val token = assertNotNull(mappings.singleOrNull { it.getString("type") == "token" })
            assertEquals("none", token.getString("normalizer"))
        }
        val nameMappings = fields["name"] as List<*>
        assertTrue(nameMappings.filterIsInstance<org.bson.Document>().any { it.getString("type") == "string" })
    }
}

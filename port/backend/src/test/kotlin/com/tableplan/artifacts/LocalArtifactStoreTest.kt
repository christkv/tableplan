package com.tableplan.artifacts

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class LocalArtifactStoreTest {
    @TempDir
    lateinit var directory: Path

    @Test
    fun `stores reads describes and deletes an artifact`() {
        val store = LocalArtifactStore(directory, maximumBytes = 1024)
        val key = "households/household/users/user/recipe-ingestions/ingestion/source"
        val contents = "A recipe".toByteArray()

        store.put(key, contents)

        assertContentEquals(contents, store.get(key))
        assertEquals(ArtifactMetadata(key, contents.size.toLong()), store.head(key))
        store.delete(key)
        assertNull(store.head(key))
    }

    @Test
    fun `rejects oversized content and traversal keys`() {
        val store = LocalArtifactStore(directory, maximumBytes = 4)

        assertFailsWith<IllegalArgumentException> {
            store.put("households/household/source", ByteArray(5))
        }
        assertFailsWith<IllegalArgumentException> {
            store.put("../outside", byteArrayOf(1))
        }
    }
}

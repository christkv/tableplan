package com.tableplan.config

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.util.Properties
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class DotenvLoaderTest {
    @TempDir
    lateinit var directory: Path

    @Test
    fun `loads common dotenv syntax without overriding process values`() {
        val path = directory.resolve(".env")
        Files.writeString(
            path,
            """
            # Local configuration
            PLAIN=from-file
            export EXPORTED=yes
            DOUBLE_QUOTED="value with # text"
            SINGLE_QUOTED='literal value' # comment
            INLINE_COMMENT=value # ignored
            AWS_ACCESS_KEY_ID=abcde12345
            """.trimIndent(),
        )
        val properties = Properties()
        val announcements = mutableListOf<String>()

        DotenvLoader.load(
            path = path,
            environment = mapOf("PLAIN" to "from-environment"),
            systemProperties = properties,
            announce = announcements::add,
        )

        assertEquals(null, properties.getProperty("PLAIN"))
        assertEquals("yes", properties.getProperty("EXPORTED"))
        assertEquals("value with # text", properties.getProperty("DOUBLE_QUOTED"))
        assertEquals("literal value", properties.getProperty("SINGLE_QUOTED"))
        assertEquals("value", properties.getProperty("INLINE_COMMENT"))
        assertEquals("abcde12345", properties.getProperty("AWS_ACCESS_KEY_ID"))
        assertEquals("abcde12345", properties.getProperty("aws.accessKeyId"))
        assertTrue(announcements.single().contains("Loaded .env file"))
        assertTrue(announcements.single().contains("5 settings applied, 1 overridden"))
    }

    @Test
    fun `announces when no dotenv file exists`() {
        val announcements = mutableListOf<String>()

        DotenvLoader.load(
            path = directory.resolve("missing.env"),
            environment = emptyMap(),
            systemProperties = Properties(),
            announce = announcements::add,
        )

        assertTrue(announcements.single().contains("No .env file found"))
    }

    @Test
    fun `reports malformed entries without including their value`() {
        val path = directory.resolve(".env")
        Files.writeString(path, "OPENROUTER_API_KEY \"secret-value\"")

        val error =
            assertFailsWith<IllegalArgumentException> {
                DotenvLoader.load(path, emptyMap(), Properties()) {}
            }

        assertTrue(error.message.orEmpty().contains(".env entry"))
        assertTrue(!error.message.orEmpty().contains("secret-value"))
    }
}

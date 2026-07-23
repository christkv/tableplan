package com.tableplan.config

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

class StartupEnvironmentReporterTest {
    @Test
    fun `shows no more than five characters of a sensitive value`() {
        assertEquals("abcde…", displayStartupValue("abcdefghijk", sensitive = true))
        assertEquals("<set; hidden>", displayStartupValue("abcd", sensitive = true))
        assertEquals("<not set>", displayStartupValue("", sensitive = true))
    }

    @Test
    fun `prints ordinary values while removing log control characters`() {
        assertEquals("http://localhost:9090", displayStartupValue("http://localhost:9090", sensitive = false))
        assertEquals("first second", displayStartupValue("first\nsecond", sensitive = false))
    }
}

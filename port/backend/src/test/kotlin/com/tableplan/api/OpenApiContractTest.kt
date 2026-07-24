package com.tableplan.api

import org.junit.jupiter.api.Test
import tools.jackson.dataformat.yaml.YAMLMapper
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class OpenApiContractTest {
    @Test
    fun `checked in OpenAPI parses and has unique operation IDs`() {
        val contract =
            assertNotNull(javaClass.classLoader.getResourceAsStream("contracts/openapi.yaml")).use {
                YAMLMapper.builder().build().readValue(it, Map::class.java)
            }
        assertEquals("3.1.0", contract["openapi"])
        val paths = contract["paths"] as Map<*, *>
        val methods = setOf("get", "post", "put", "patch", "delete", "options", "head", "trace")
        val operationIds =
            paths.values
                .flatMap { (it as Map<*, *>).filterKeys { key -> key in methods }.values }
                .map { (it as Map<*, *>)["operationId"] as? String }
        assertEquals(68, operationIds.size)
        assertEquals(operationIds.size, operationIds.filterNotNull().distinct().size)
    }
}

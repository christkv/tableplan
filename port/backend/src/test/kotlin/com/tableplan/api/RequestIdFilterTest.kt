package com.tableplan.api

import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockFilterChain
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class RequestIdFilterTest {
    @Test
    fun `preserves valid request identifiers`() {
        val request = MockHttpServletRequest().apply {
            addHeader("X-Request-Id", "637f46dd-02af-49d8-a545-1dce3cd15d8d")
        }
        val response = MockHttpServletResponse()

        RequestIdFilter().doFilter(request, response, MockFilterChain())

        assertEquals("637f46dd-02af-49d8-a545-1dce3cd15d8d", response.getHeader("X-Request-Id"))
    }

    @Test
    fun `replaces invalid request identifiers`() {
        val request = MockHttpServletRequest().apply { addHeader("X-Request-Id", "not-a-uuid") }
        val response = MockHttpServletResponse()

        RequestIdFilter().doFilter(request, response, MockFilterChain())

        assertNotNull(response.getHeader("X-Request-Id"))
    }
}


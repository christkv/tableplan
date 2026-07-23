package com.tableplan.planning

import com.tableplan.api.ApiException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class PlanDatesTest {
    @Test
    fun `week starts on Monday and remains date-only`() {
        val (start, end) = PlanDates.week("2026-07-23")
        assertEquals("2026-07-20", start.toString())
        assertEquals("2026-07-26", end.toString())
    }

    @Test
    fun `invalid calendar dates are rejected`() {
        assertFailsWith<ApiException> { PlanDates.parse("2026-02-30") }
    }
}


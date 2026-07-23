package com.tableplan.planning

import com.tableplan.api.ApiException
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.time.temporal.TemporalAdjusters

object PlanDates {
    fun parse(value: String): LocalDate =
        try {
            LocalDate.parse(value)
        } catch (_: DateTimeParseException) {
            throw ApiException(400, "date_invalid", "Date must be a valid YYYY-MM-DD value.")
        }

    fun startOfWeek(value: String): LocalDate =
        parse(value).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

    fun week(value: String): Pair<LocalDate, LocalDate> =
        startOfWeek(value).let { it to it.plusDays(6) }

    fun requireInWeek(value: String, startsOn: LocalDate, endsOn: LocalDate): LocalDate =
        parse(value).takeIf { !it.isBefore(startsOn) && !it.isAfter(endsOn) }
            ?: throw ApiException(400, "plan_date_outside_week", "Planned date is outside the selected week.")
}


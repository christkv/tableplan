package com.tableplan.api

import java.util.UUID

data class ApiError(
    val code: String,
    val message: String,
    val requestId: UUID,
    val fieldErrors: Map<String, String> = emptyMap(),
)

class ApiException(
    val status: Int,
    val code: String,
    override val message: String,
) : RuntimeException(message)


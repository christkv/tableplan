package com.tableplan.jobs

interface JobHandler {
    val type: String

    fun handle(job: LeasedJob)
}

class RetryableJobException(
    val code: String,
    cause: Throwable? = null,
) : RuntimeException(code, cause)


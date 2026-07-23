package com.tableplan.odm

import java.util.UUID

abstract class StringIdDocument {
    @Field("_id")
    var id: String? = null

    fun requireValidId(): String =
        id?.takeIf { it.isNotBlank() }
            ?: throw IllegalStateException("Tableplan documents require a non-blank string _id")

    protected fun assignNewId(): String =
        UUID.randomUUID().toString().also { id = it }
}


package com.tableplan.api

import com.tableplan.TableplanApplication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class SystemController {
    @GetMapping("/api/v1/system/version")
    fun version() =
        mapOf(
            "application" to "tableplan",
            "version" to (TableplanApplication::class.java.`package`.implementationVersion ?: "development"),
            "runtime" to "spring-boot",
        )
}

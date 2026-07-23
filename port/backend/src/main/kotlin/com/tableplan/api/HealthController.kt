package com.tableplan.api

import com.mongodb.client.MongoDatabase
import org.bson.Document
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class HealthController(
    private val database: MongoDatabase,
) {
    @GetMapping("/health/live")
    fun live() = mapOf("status" to "UP")

    @GetMapping("/health/ready", "/api/v1/health")
    fun ready(): ResponseEntity<Map<String, String>> =
        runCatching {
            database.runCommand(Document("ping", 1))
            ResponseEntity.ok(mapOf("status" to "UP", "database" to database.name))
        }.getOrElse {
            ResponseEntity.status(503).body(mapOf("status" to "DOWN"))
        }
}


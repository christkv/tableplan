package com.tableplan.config

import jakarta.validation.Valid
import jakarta.validation.constraints.Max
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.validation.annotation.Validated

@Validated
@ConfigurationProperties("tableplan")
data class TableplanProperties(
    @field:NotBlank val publicOrigin: String = "http://localhost:8080",
    val deliverySecret: String = "",
    @field:Valid val mongo: Mongo = Mongo(),
    @field:Valid val jobs: Jobs = Jobs(),
    @field:Valid val artifacts: Artifacts = Artifacts(),
    @field:Valid val extraction: Extraction = Extraction(),
) {
    data class Mongo(
        @field:NotBlank val uri: String = "mongodb://127.0.0.1:27017/?replicaSet=rs0",
        @field:NotBlank val database: String = "application_local",
        @field:Min(1) @field:Max(100) val maxPoolSize: Int = 20,
        @field:Min(0) @field:Max(100) val minPoolSize: Int = 0,
        @field:Min(100) val waitQueueTimeoutMs: Long = 2_000,
        @field:Min(100) val serverSelectionTimeoutMs: Long = 3_000,
    )

    data class Jobs(
        val enabled: Boolean = false,
        @field:Min(1) @field:Max(32) val concurrency: Int = 2,
    )

    data class Artifacts(
        val mode: String = "local",
        @field:NotBlank val localDirectory: String = "artifacts",
        @field:Min(1) @field:Max(100) val maxMegabytes: Int = 10,
        val bucket: String = "",
        val region: String = "auto",
        val endpoint: String = "",
        val pathStyleAccess: Boolean = false,
    )

    data class Extraction(
        val provider: String = "deterministic",
        val openrouterApiKey: String = "",
        val openrouterModel: String = "openai/gpt-4.1-mini",
        val openrouterBaseUrl: String = "https://openrouter.ai/api/v1/chat/completions",
        @field:Min(1) @field:Max(120) val timeoutSeconds: Long = 45,
    )
}

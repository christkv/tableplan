package com.tableplan.config

import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.core.env.Environment
import org.springframework.stereotype.Component

@Component
class StartupEnvironmentReporter(
    private val environment: Environment,
    private val properties: TableplanProperties,
) : ApplicationRunner {
    private val logger = LoggerFactory.getLogger(javaClass)

    override fun run(args: ApplicationArguments) {
        val settings =
            listOf(
                setting("SERVER_PORT", environment.getProperty("server.port") ?: "9090"),
                setting("TABLEPLAN_PUBLIC_ORIGIN", properties.publicOrigin),
                setting("TABLEPLAN_SESSION_COOKIE_SECURE", properties.auth.sessionCookieSecure),
                setting(
                    "TABLEPLAN_VIRTUAL_THREADS",
                    environment.getProperty("spring.threads.virtual.enabled") ?: "true",
                ),
                setting("TABLEPLAN_DELIVERY_SECRET", properties.deliverySecret, sensitive = true),
                setting("TABLEPLAN_MONGO_URI", properties.mongo.uri, sensitive = true),
                setting("TABLEPLAN_MONGO_DATABASE", properties.mongo.database),
                setting("TABLEPLAN_MONGO_MAX_POOL_SIZE", properties.mongo.maxPoolSize),
                setting("TABLEPLAN_MONGO_MIN_POOL_SIZE", properties.mongo.minPoolSize),
                setting("TABLEPLAN_MONGO_WAIT_QUEUE_TIMEOUT_MS", properties.mongo.waitQueueTimeoutMs),
                setting(
                    "TABLEPLAN_MONGO_SERVER_SELECTION_TIMEOUT_MS",
                    properties.mongo.serverSelectionTimeoutMs,
                ),
                setting("JOBS_ENABLED", properties.jobs.enabled),
                setting("TABLEPLAN_JOB_CONCURRENCY", properties.jobs.concurrency),
                setting("TABLEPLAN_ARTIFACT_MODE", properties.artifacts.mode),
                setting("TABLEPLAN_ARTIFACT_DIRECTORY", properties.artifacts.localDirectory),
                setting("TABLEPLAN_ARTIFACT_MAX_MEGABYTES", properties.artifacts.maxMegabytes),
                setting("TABLEPLAN_ARTIFACT_BUCKET", properties.artifacts.bucket),
                setting("TABLEPLAN_ARTIFACT_REGION", properties.artifacts.region),
                setting("TABLEPLAN_ARTIFACT_ENDPOINT", properties.artifacts.endpoint),
                setting("TABLEPLAN_ARTIFACT_PATH_STYLE", properties.artifacts.pathStyleAccess),
                setting(
                    "TABLEPLAN_ARTIFACT_CHUNKED_ENCODING_ENABLED",
                    properties.artifacts.chunkedEncodingEnabled,
                ),
                setting(
                    "TABLEPLAN_ARTIFACT_SEND_SSE_HEADER",
                    properties.artifacts.sendServerSideEncryptionHeader,
                ),
                setting("TABLEPLAN_ARTIFACT_ACCESS_KEY_ID", properties.artifacts.accessKeyId, sensitive = true),
                setting(
                    "TABLEPLAN_ARTIFACT_SECRET_ACCESS_KEY",
                    properties.artifacts.secretAccessKey,
                    sensitive = true,
                ),
                setting("TABLEPLAN_ARTIFACT_SESSION_TOKEN", properties.artifacts.sessionToken, sensitive = true),
                setting("TABLEPLAN_EXTRACTION_PROVIDER", properties.extraction.provider),
                setting("OPENROUTER_API_KEY", properties.extraction.openrouterApiKey, sensitive = true),
                setting("TABLEPLAN_OPENROUTER_MODEL", properties.extraction.openrouterModel),
                setting("TABLEPLAN_OPENROUTER_BASE_URL", properties.extraction.openrouterBaseUrl),
                setting("TABLEPLAN_EXTRACTION_TIMEOUT_SECONDS", properties.extraction.timeoutSeconds),
                setting(
                    "SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_CLIENT_ID",
                    environment.getProperty("SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_CLIENT_ID"),
                    sensitive = true,
                ),
                setting(
                    "SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_CLIENT_SECRET",
                    environment.getProperty("SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_CLIENT_SECRET"),
                    sensitive = true,
                ),
                setting(
                    "SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_REDIRECT_URI",
                    environment.getProperty(
                        "spring.security.oauth2.client.registration.google.redirect-uri",
                    ),
                ),
                setting("SPRING_MAIL_HOST", environment.getProperty("SPRING_MAIL_HOST")),
                setting("SPRING_MAIL_PORT", environment.getProperty("SPRING_MAIL_PORT")),
                setting("SPRING_MAIL_USERNAME", environment.getProperty("SPRING_MAIL_USERNAME"), sensitive = true),
                setting("SPRING_MAIL_PASSWORD", environment.getProperty("SPRING_MAIL_PASSWORD"), sensitive = true),
            )

        logger.info(
            "Table Rhythm startup environment:\n{}",
            settings.joinToString(separator = "\n") { "  ${it.first}=${it.second}" },
        )
    }

    private fun setting(
        name: String,
        value: Any?,
        sensitive: Boolean = false,
    ) = name to displayStartupValue(value?.toString(), sensitive)
}

internal fun displayStartupValue(
    value: String?,
    sensitive: Boolean,
): String {
    if (value.isNullOrBlank()) return "<not set>"
    val sanitized = value.replace(Regex("[\\r\\n\\t]"), " ")
    if (!sensitive) return sanitized.take(500)
    return if (sanitized.length <= SECRET_PREFIX_LENGTH) {
        "<set; hidden>"
    } else {
        "${sanitized.take(SECRET_PREFIX_LENGTH)}…"
    }
}

private const val SECRET_PREFIX_LENGTH = 5

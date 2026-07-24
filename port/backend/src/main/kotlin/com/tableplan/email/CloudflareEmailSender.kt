package com.tableplan.email

import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.UUID

class CloudflareEmailSender internal constructor(
    private val accountId: String,
    private val apiToken: String,
    private val fromAddress: String,
    private val fromName: String,
    private val timeout: Duration,
    private val mapper: ObjectMapper,
    private val apiBaseUri: URI,
    private val client: HttpClient,
) : EmailSender {
    constructor(
        accountId: String,
        apiToken: String,
        fromAddress: String,
        fromName: String,
        timeoutSeconds: Long,
        mapper: ObjectMapper,
    ) : this(
        accountId = accountId.trim(),
        apiToken = apiToken.trim(),
        fromAddress = fromAddress.trim(),
        fromName = fromName.trim(),
        timeout = Duration.ofSeconds(timeoutSeconds),
        mapper = mapper,
        apiBaseUri = CLOUDFLARE_API_BASE_URI,
        client =
            HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build(),
    )

    init {
        require(accountId.matches(Regex("[A-Za-z0-9_-]{1,64}"))) {
            "tableplan.email.cloudflare-account-id is invalid"
        }
        require(apiToken.isNotBlank()) {
            "tableplan.email.cloudflare-api-token must be configured"
        }
        require(fromAddress.matches(Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"))) {
            "tableplan.email.from-address must be a valid email address"
        }
        require(fromName.isNotBlank()) {
            "tableplan.email.from-name must be configured"
        }
        require(!timeout.isZero && !timeout.isNegative) {
            "tableplan.email.timeout-seconds must be positive"
        }
    }

    override fun send(recipient: String, subject: String, html: String, text: String): String {
        val body =
            mapper.writeValueAsString(
                mapOf(
                    "to" to recipient,
                    "from" to mapOf("address" to fromAddress, "name" to fromName),
                    "subject" to subject,
                    "html" to html,
                    "text" to text,
                ),
            )
        val encodedAccountId = URLEncoder.encode(accountId, StandardCharsets.UTF_8)
        val request =
            HttpRequest.newBuilder(
                apiBaseUri.resolve("/client/v4/accounts/$encodedAccountId/email/sending/send"),
            ).timeout(timeout)
                .header("Authorization", "Bearer $apiToken")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build()
        val response =
            try {
                client.send(request, HttpResponse.BodyHandlers.ofString())
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
                throw CloudflareEmailException("cloudflare_email_interrupted", retryable = true, cause = error)
            } catch (error: Exception) {
                throw CloudflareEmailException("cloudflare_email_unavailable", retryable = true, cause = error)
            }
        if (response.statusCode() !in 200..299) {
            val status = response.statusCode()
            val providerCode =
                runCatching {
                    mapper.readTree(response.body())
                        .path("errors")
                        .path(0)
                        .path("code")
                        .asInt(-1)
                        .takeIf { it >= 0 }
                }.getOrNull()
            throw CloudflareEmailException(
                code =
                    buildString {
                        append("cloudflare_email_http_")
                        append(status)
                        if (providerCode != null) {
                            append("_cf_")
                            append(providerCode)
                        }
                    },
                retryable = status == 408 || status == 429 || status >= 500,
            )
        }

        val root =
            runCatching { mapper.readTree(response.body()) }
                .getOrElse {
                    throw CloudflareEmailException(
                        "cloudflare_email_invalid_response",
                        retryable = true,
                        cause = it,
                    )
                }
        if (!root.path("success").asBoolean(false)) {
            throw CloudflareEmailException("cloudflare_email_rejected", retryable = false)
        }
        val result = root.path("result")
        if (result.path("permanent_bounces").any { it.asString("") == recipient }) {
            throw CloudflareEmailException("cloudflare_email_permanent_bounce", retryable = false)
        }
        val messageId = result.path("message_id").asString("")
        if (messageId.isNotBlank()) return messageId

        val accepted =
            sequenceOf("delivered", "queued")
                .flatMap { result.path(it).asSequence() }
                .any { it.asString("") == recipient }
        if (!accepted) {
            throw CloudflareEmailException("cloudflare_email_recipient_unconfirmed", retryable = false)
        }
        return "cloudflare-accepted-${UUID.randomUUID()}"
    }

    private companion object {
        val CLOUDFLARE_API_BASE_URI: URI = URI.create("https://api.cloudflare.com")
    }
}

class CloudflareEmailException(
    val code: String,
    val retryable: Boolean,
    cause: Throwable? = null,
) : RuntimeException(code, cause)

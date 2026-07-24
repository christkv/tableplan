package com.tableplan.email

import com.sun.net.httpserver.HttpServer
import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper
import java.net.InetSocketAddress
import java.net.URI
import java.net.http.HttpClient
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class CloudflareEmailSenderTest {
    private val mapper = JsonMapper.builder().build()

    @Test
    fun `submits the branded message to Cloudflare and returns its message id`() {
        val requestAuthorization = AtomicReference<String>()
        val requestBody = AtomicReference<String>()
        val server =
            emailServer(
                status = 200,
                response =
                    """
                    {
                      "success": true,
                      "errors": [],
                      "messages": [],
                      "result": {
                        "delivered": ["cook@example.com"],
                        "permanent_bounces": [],
                        "queued": [],
                        "message_id": "<cloudflare-message@example.com>"
                      }
                    }
                    """.trimIndent(),
                capture = { authorization, body ->
                    requestAuthorization.set(authorization)
                    requestBody.set(body)
                },
            )
        try {
            val sender = senderFor(server)

            val providerId =
                sender.send(
                    recipient = "cook@example.com",
                    subject = "Your shopping list",
                    html = "<p>Ready</p>",
                    text = "Ready",
                )

            assertEquals("<cloudflare-message@example.com>", providerId)
            assertEquals("Bearer test-api-token", requestAuthorization.get())
            val body = mapper.readTree(requestBody.get())
            assertEquals("cook@example.com", body.path("to").asString(""))
            assertEquals("shopping@tablerhythm.com", body.path("from").path("address").asString(""))
            assertEquals("Table Rhythm Alpha", body.path("from").path("name").asString(""))
            assertEquals("<p>Ready</p>", body.path("html").asString(""))
            assertEquals("Ready", body.path("text").asString(""))
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun `rejects a permanent bounce even when Cloudflare returns HTTP success`() {
        val server =
            emailServer(
                status = 200,
                response =
                    """
                    {
                      "success": true,
                      "result": {
                        "delivered": [],
                        "permanent_bounces": ["cook@example.com"],
                        "queued": [],
                        "message_id": "<cloudflare-message@example.com>"
                      }
                    }
                    """.trimIndent(),
            )
        try {
            val error =
                assertFailsWith<CloudflareEmailException> {
                    senderFor(server).send("cook@example.com", "Subject", "<p>Body</p>", "Body")
                }

            assertEquals("cloudflare_email_permanent_bounce", error.message)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun `accepts a message id when immediate recipient status arrays are empty`() {
        val server =
            emailServer(
                status = 200,
                response =
                    """
                    {
                      "success": true,
                      "result": {
                        "delivered": [],
                        "permanent_bounces": [],
                        "queued": [],
                        "message_id": "<asynchronous-message@example.com>"
                      }
                    }
                    """.trimIndent(),
            )
        try {
            val providerId =
                senderFor(server).send("cook@example.com", "Subject", "<p>Body</p>", "Body")

            assertEquals("<asynchronous-message@example.com>", providerId)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun `turns Cloudflare HTTP errors into delivery failures without exposing the response`() {
        val server =
            emailServer(
                status = 403,
                response = """{"success":false,"errors":[{"code":10102,"message":"secret provider detail"}]}""",
            )
        try {
            val error =
                assertFailsWith<CloudflareEmailException> {
                    senderFor(server).send("cook@example.com", "Subject", "<p>Body</p>", "Body")
                }

            assertEquals("cloudflare_email_http_403_cf_10102", error.message)
            assertTrue(!error.retryable)
            assertTrue(!error.message.orEmpty().contains("secret provider detail"))
        } finally {
            server.stop(0)
        }
    }

    private fun senderFor(server: HttpServer) =
        CloudflareEmailSender(
            accountId = "account-id",
            apiToken = "test-api-token",
            fromAddress = "shopping@tablerhythm.com",
            fromName = "Table Rhythm Alpha",
            timeout = Duration.ofSeconds(2),
            mapper = mapper,
            apiBaseUri = URI.create("http://127.0.0.1:${server.address.port}"),
            client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build(),
        )

    private fun emailServer(
        status: Int,
        response: String,
        capture: (String?, String) -> Unit = { _, _ -> },
    ): HttpServer =
        HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            createContext("/client/v4/accounts/account-id/email/sending/send") { exchange ->
                val body = exchange.requestBody.readAllBytes().toString(StandardCharsets.UTF_8)
                capture(exchange.requestHeaders.getFirst("Authorization"), body)
                val responseBytes = response.toByteArray(StandardCharsets.UTF_8)
                exchange.responseHeaders.add("Content-Type", "application/json")
                exchange.sendResponseHeaders(status, responseBytes.size.toLong())
                exchange.responseBody.use { it.write(responseBytes) }
            }
            start()
        }
}

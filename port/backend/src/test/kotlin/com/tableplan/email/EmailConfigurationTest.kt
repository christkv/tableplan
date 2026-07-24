package com.tableplan.email

import com.tableplan.config.TableplanProperties
import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

class EmailConfigurationTest {
    private val configuration = EmailConfiguration()
    private val mapper = JsonMapper.builder().build()

    @Test
    fun `uses captured delivery when Cloudflare credentials are absent`() {
        val sender =
            configuration.emailSender(
                TableplanProperties(
                    email =
                        TableplanProperties.Email(
                            fromAddress = "shopping@tablerhythm.com",
                        ),
                ),
                mapper,
            )

        assertIs<LoggingEmailSender>(sender)
    }

    @Test
    fun `uses Cloudflare REST delivery when both credentials are configured`() {
        val sender =
            configuration.emailSender(
                cloudflareProperties(accountId = "account-id", apiToken = "api-token"),
                mapper,
            )

        assertIs<CloudflareEmailSender>(sender)
    }

    @Test
    fun `does not silently capture messages with partial Cloudflare configuration`() {
        val error =
            assertFailsWith<IllegalStateException> {
                configuration.emailSender(
                    cloudflareProperties(accountId = "account-id", apiToken = ""),
                    mapper,
                )
            }

        assertTrue(error.message.orEmpty().contains("Refusing to fall back"))
    }

    private fun cloudflareProperties(accountId: String, apiToken: String) =
        TableplanProperties(
            email =
                TableplanProperties.Email(
                    cloudflareAccountId = accountId,
                    cloudflareApiToken = apiToken,
                    fromAddress = "shopping@tablerhythm.com",
                    fromName = "Table Rhythm",
                ),
        )
}

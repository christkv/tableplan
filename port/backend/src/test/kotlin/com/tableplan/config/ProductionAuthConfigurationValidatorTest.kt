package com.tableplan.config

import org.junit.jupiter.api.Test
import kotlin.test.assertFailsWith

class ProductionAuthConfigurationValidatorTest {
    @Test
    fun `accepts an exact secure production oauth configuration`() {
        validateProductionAuthConfiguration(
            production = true,
            publicOrigin = "https://app.example.com",
            sessionCookieSecure = true,
            googleClientId = "client-id",
            googleRedirectUri = "https://app.example.com/login/oauth2/code/google",
        )
    }

    @Test
    fun `rejects insecure or mismatched production auth configuration`() {
        assertFailsWith<IllegalStateException> {
            validateProductionAuthConfiguration(
                production = true,
                publicOrigin = "http://app.example.com",
                sessionCookieSecure = true,
                googleClientId = "client-id",
                googleRedirectUri = "http://app.example.com/login/oauth2/code/google",
            )
        }
        assertFailsWith<IllegalStateException> {
            validateProductionAuthConfiguration(
                production = true,
                publicOrigin = "https://app.example.com",
                sessionCookieSecure = false,
                googleClientId = "client-id",
                googleRedirectUri = "https://app.example.com/login/oauth2/code/google",
            )
        }
        assertFailsWith<IllegalStateException> {
            validateProductionAuthConfiguration(
                production = true,
                publicOrigin = "https://app.example.com",
                sessionCookieSecure = true,
                googleClientId = "client-id",
                googleRedirectUri = "https://other.example.com/login/oauth2/code/google",
            )
        }
    }
}

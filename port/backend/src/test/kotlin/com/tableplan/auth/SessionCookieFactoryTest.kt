package com.tableplan.auth

import com.tableplan.config.TableplanProperties
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletRequest
import java.time.Instant
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SessionCookieFactoryTest {
    @Test
    fun `creates a host-only local session cookie`() {
        val factory = SessionCookieFactory(TableplanProperties())
        val cookie =
            factory.create(
                CreatedSession("x".repeat(48), Instant.now().plusSeconds(3_600)),
                MockHttpServletRequest(),
            ).toString()

        assertTrue(cookie.startsWith("$SESSION_COOKIE="))
        assertTrue(cookie.contains("; Path=/"))
        assertTrue(cookie.contains("; HttpOnly"))
        assertTrue(cookie.contains("; SameSite=Lax"))
        assertFalse(cookie.contains("; Secure"))
        assertFalse(cookie.contains("; Domain="))
    }

    @Test
    fun `forces secure cookies in production configuration`() {
        val properties =
            TableplanProperties(
                auth = TableplanProperties.Auth(sessionCookieSecure = true),
            )
        val cookie =
            SessionCookieFactory(properties)
                .create(
                    CreatedSession("x".repeat(48), Instant.now().plusSeconds(3_600)),
                    MockHttpServletRequest(),
                ).toString()

        assertTrue(cookie.contains("; Secure"))
    }
}

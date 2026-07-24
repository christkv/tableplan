package com.tableplan.auth

import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import org.springframework.mock.web.MockFilterChain
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import kotlin.test.assertEquals

class SessionAuthenticationFilterTest {
    @AfterEach
    fun clearSecurityContext() {
        SecurityContextHolder.clearContext()
    }

    @Test
    fun `tableplan cookie replaces a previously restored foreign authentication`() {
        val token = "x".repeat(48)
        val principal = TableplanPrincipal("user-1", "household-1", AuthenticationKind.SESSION)
        val sessions = Mockito.mock(SessionRepository::class.java)
        Mockito.`when`(sessions.resolve(token)).thenReturn(principal)
        SecurityContextHolder.getContext().authentication =
            UsernamePasswordAuthenticationToken.authenticated("google-user", "n/a", emptyList())
        val request =
            MockHttpServletRequest("GET", "/api/auth/session").apply {
                setCookies(Cookie(SESSION_COOKIE, token))
            }

        SessionAuthenticationFilter(sessions).doFilter(
            request,
            MockHttpServletResponse(),
            MockFilterChain(),
        )

        assertEquals(principal, SecurityContextHolder.getContext().authentication?.principal)
    }
}

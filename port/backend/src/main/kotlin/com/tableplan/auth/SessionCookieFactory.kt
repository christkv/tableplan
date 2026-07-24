package com.tableplan.auth

import com.tableplan.config.TableplanProperties
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.ResponseCookie
import org.springframework.stereotype.Component
import java.time.Duration
import java.time.Instant

@Component
class SessionCookieFactory(
    private val properties: TableplanProperties,
) {
    fun create(
        session: CreatedSession,
        request: HttpServletRequest,
    ): ResponseCookie =
        base(SESSION_COOKIE, session.token, request)
            .maxAge(Duration.between(Instant.now(), session.expiresAt))
            .build()

    fun clear(request: HttpServletRequest): ResponseCookie =
        base(SESSION_COOKIE, "", request)
            .maxAge(Duration.ZERO)
            .build()

    fun clearServletSession(request: HttpServletRequest): ResponseCookie =
        base(SERVLET_SESSION_COOKIE, "", request)
            .maxAge(Duration.ZERO)
            .build()

    private fun base(
        name: String,
        value: String,
        request: HttpServletRequest,
    ) = ResponseCookie.from(name, value)
        .httpOnly(true)
        .secure(properties.auth.sessionCookieSecure || request.isSecure)
        .sameSite("Lax")
        .path("/")
}

internal const val SERVLET_SESSION_COOKIE = "JSESSIONID"

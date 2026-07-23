package com.tableplan.auth

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpHeaders
import org.springframework.http.ResponseCookie
import org.springframework.security.core.Authentication
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken
import org.springframework.security.web.authentication.AuthenticationSuccessHandler
import org.springframework.stereotype.Component
import java.time.Duration

@Component
class GoogleOAuthSuccessHandler(
    private val accounts: AccountService,
    private val sessions: SessionRepository,
) : AuthenticationSuccessHandler {
    override fun onAuthenticationSuccess(
        request: HttpServletRequest,
        response: HttpServletResponse,
        authentication: Authentication,
    ) {
        val oauth = authentication as? OAuth2AuthenticationToken
        if (oauth == null || oauth.authorizedClientRegistrationId != "google") {
            response.sendRedirect("/auth/error?code=oauth_provider_invalid")
            return
        }
        runCatching {
            val attributes = oauth.principal.attributes
            val user =
                accounts.authenticateGoogle(
                    subject = attributes["sub"]?.toString().orEmpty(),
                    emailInput = attributes["email"]?.toString().orEmpty(),
                    nameInput = attributes["name"]?.toString().orEmpty(),
                    emailVerified = attributes["email_verified"] == true,
                )
            val session = sessions.create(user.id, user.householdId)
            response.addHeader(
                HttpHeaders.SET_COOKIE,
                ResponseCookie.from(SESSION_COOKIE, session.token)
                    .httpOnly(true)
                    .secure(request.isSecure)
                    .sameSite("Lax")
                    .path("/")
                    .maxAge(Duration.between(java.time.Instant.now(), session.expiresAt))
                    .build()
                    .toString(),
            )
            response.sendRedirect("/recipes")
        }.onFailure {
            response.sendRedirect("/auth/error?code=oauth_failed")
        }
    }
}

package com.tableplan.auth

import com.tableplan.api.REQUEST_ID_ATTRIBUTE
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.http.HttpHeaders
import org.springframework.security.core.AuthenticationException
import org.springframework.security.oauth2.core.OAuth2AuthenticationException
import org.springframework.security.web.authentication.AuthenticationFailureHandler
import org.springframework.stereotype.Component

@Component
class GoogleOAuthFailureHandler(
    private val sessionCookies: SessionCookieFactory,
) : AuthenticationFailureHandler {
    private val oauthLogger = LoggerFactory.getLogger(javaClass)

    override fun onAuthenticationFailure(
        request: HttpServletRequest,
        response: HttpServletResponse,
        exception: AuthenticationException,
    ) {
        val requestId = request.getAttribute(REQUEST_ID_ATTRIBUTE)?.toString() ?: "not-available"
        val code = oauthAuthenticationFailureCode(exception)
        oauthLogger.warn(
            "Google OAuth sign-in failed code={} requestId={} failureType={}",
            code,
            requestId,
            exception.javaClass.simpleName,
        )
        request.getSession(false)?.invalidate()
        response.addHeader(HttpHeaders.SET_COOKIE, sessionCookies.clearServletSession(request).toString())
        response.sendRedirect(oauthErrorLocation(code, requestId))
    }
}

internal fun oauthAuthenticationFailureCode(exception: AuthenticationException): String {
    val providerCode = (exception as? OAuth2AuthenticationException)?.error?.errorCode
    return when (providerCode) {
        "access_denied" -> "access_denied"
        "authorization_request_not_found", "invalid_state_parameter" -> "state_mismatch"
        "invalid_grant" -> "invalid_code"
        else -> "oauth_failed"
    }
}

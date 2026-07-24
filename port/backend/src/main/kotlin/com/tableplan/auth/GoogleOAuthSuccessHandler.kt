package com.tableplan.auth

import com.tableplan.api.ApiException
import com.tableplan.api.REQUEST_ID_ATTRIBUTE
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.http.HttpHeaders
import org.springframework.security.core.Authentication
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken
import org.springframework.security.web.authentication.AuthenticationSuccessHandler
import org.springframework.stereotype.Component

@Component
class GoogleOAuthSuccessHandler(
    private val accounts: AccountService,
    private val sessions: SessionRepository,
    private val sessionCookies: SessionCookieFactory,
) : AuthenticationSuccessHandler {
    private val oauthLogger = LoggerFactory.getLogger(javaClass)

    override fun onAuthenticationSuccess(
        request: HttpServletRequest,
        response: HttpServletResponse,
        authentication: Authentication,
    ) {
        val requestId = request.getAttribute(REQUEST_ID_ATTRIBUTE)?.toString() ?: "not-available"
        val oauth = authentication as? OAuth2AuthenticationToken
        if (oauth == null || oauth.authorizedClientRegistrationId != "google") {
            oauthLogger.error(
                "Google OAuth sign-in failed code=oauth_provider_invalid requestId={}",
                requestId,
            )
            finishOAuth(request, response, oauthErrorLocation("oauth_provider_invalid", requestId))
            return
        }
        try {
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
                sessionCookies.create(session, request).toString(),
            )
            oauthLogger.info("Google OAuth sign-in succeeded requestId={}", requestId)
            finishOAuth(request, response, oauthSuccessLocation(request))
        } catch (error: Exception) {
            val code = oauthFailureCode(error)
            val safeMessage =
                error.message.orEmpty()
                    .replace(Regex("[\\r\\n\\t]"), " ")
                    .take(240)
                    .ifBlank { "<none>" }
            oauthLogger.error(
                "Google OAuth sign-in failed code={} requestId={} failureType={} message={}",
                code,
                requestId,
                error.javaClass.simpleName,
                safeMessage,
            )
            finishOAuth(request, response, oauthErrorLocation(code, requestId))
        }
    }

    private fun finishOAuth(
        request: HttpServletRequest,
        response: HttpServletResponse,
        location: String,
    ) {
        request.getSession(false)?.invalidate()
        response.addHeader(HttpHeaders.SET_COOKIE, sessionCookies.clearServletSession(request).toString())
        response.sendRedirect(location)
    }
}

internal fun oauthFailureCode(error: Exception): String =
    (error as? ApiException)?.code
        ?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{1,128}")) }
        ?: "oauth_failed"

internal fun oauthErrorLocation(
    code: String,
    requestId: String,
) = "/auth/error?error=$code&request_id=$requestId"

internal fun oauthSuccessLocation(request: HttpServletRequest): String {
    val session = request.getSession(false)
    val returnTo = session?.getAttribute(OAUTH_RETURN_TO_ATTRIBUTE) as? String
    session?.removeAttribute(OAUTH_RETURN_TO_ATTRIBUTE)
    return validatedOAuthReturnTo(returnTo)
}

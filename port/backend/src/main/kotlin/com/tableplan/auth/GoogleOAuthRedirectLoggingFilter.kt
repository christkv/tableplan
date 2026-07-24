package com.tableplan.auth

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
class GoogleOAuthRedirectLoggingFilter : OncePerRequestFilter() {
    private val oauthLogger = LoggerFactory.getLogger(javaClass)

    override fun shouldNotFilter(request: HttpServletRequest) =
        request.method != "GET" ||
            request.requestURI !in setOf(GOOGLE_AUTHORIZATION_PATH, GOOGLE_CALLBACK_PATH)

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        if (request.requestURI == GOOGLE_AUTHORIZATION_PATH) {
            request.getSession(true).setAttribute(
                OAUTH_RETURN_TO_ATTRIBUTE,
                validatedOAuthReturnTo(request.getParameter("returnTo")),
            )
        }
        filterChain.doFilter(request, response)
        if (request.requestURI == GOOGLE_CALLBACK_PATH) {
            val sessionCookie =
                response.getHeaders("Set-Cookie")
                    .firstOrNull { it.startsWith("$SESSION_COOKIE=") }
            oauthLogger.info(
                "Google OAuth callback response status={} redirect={} sessionCookieIssued={} sessionCookieSecure={}",
                response.status,
                response.getHeader("Location") ?: "<none>",
                sessionCookie != null,
                sessionCookie?.contains("; Secure", ignoreCase = true) == true,
            )
        } else {
            val redirectUri = extractGoogleRedirectUri(response.getHeader("Location"))
            if (redirectUri == null) {
                oauthLogger.info(
                    "Google OAuth redirect URI was not generated (HTTP status {}).",
                    response.status,
                )
            } else {
                oauthLogger.info("Google OAuth redirect URI sent to Google: {}", redirectUri)
            }
        }
    }
}

internal fun extractGoogleRedirectUri(location: String?): String? {
    if (location.isNullOrBlank()) return null
    val query = runCatching { URI.create(location).rawQuery }.getOrNull() ?: return null
    return query.split('&')
        .asSequence()
        .map { parameter -> parameter.substringBefore('=') to parameter.substringAfter('=', "") }
        .firstOrNull { (name, _) -> name == "redirect_uri" }
        ?.second
        ?.let { value -> URLDecoder.decode(value, StandardCharsets.UTF_8) }
        ?.takeIf(String::isNotBlank)
}

internal fun validatedOAuthReturnTo(value: String?): String {
    if (value.isNullOrBlank() || !value.startsWith("/") || value.startsWith("//")) return DEFAULT_OAUTH_RETURN_TO
    if (value.any { it == '\\' || it == '\r' || it == '\n' }) return DEFAULT_OAUTH_RETURN_TO
    val uri = runCatching { URI.create(value) }.getOrNull() ?: return DEFAULT_OAUTH_RETURN_TO
    if (uri.isAbsolute || uri.rawAuthority != null || uri.rawFragment != null) return DEFAULT_OAUTH_RETURN_TO
    return value
}

internal const val OAUTH_RETURN_TO_ATTRIBUTE = "tableplan.oauth.returnTo"
internal const val DEFAULT_OAUTH_RETURN_TO = "/recipes"
private const val GOOGLE_AUTHORIZATION_PATH = "/oauth2/authorization/google"
private const val GOOGLE_CALLBACK_PATH = "/login/oauth2/code/google"

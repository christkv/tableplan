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
            validatedOAuthReturnOrigin(
                request.getParameter("return_origin"),
                request.scheme,
                request.serverName,
            )?.let { origin ->
                request.getSession(true).setAttribute(OAUTH_RETURN_ORIGIN_ATTRIBUTE, origin)
            }
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

internal fun validatedOAuthReturnOrigin(
    value: String?,
    requestScheme: String,
    requestHost: String,
): String? {
    if (value.isNullOrBlank()) return null
    val uri = runCatching { URI.create(value) }.getOrNull() ?: return null
    if (uri.scheme !in setOf("http", "https")) return null
    if (!uri.scheme.equals(requestScheme, ignoreCase = true)) return null
    if (!uri.host.equals(requestHost, ignoreCase = true)) return null
    if (uri.userInfo != null || uri.query != null || uri.fragment != null) return null
    if (uri.path.isNotEmpty() && uri.path != "/") return null
    return "${uri.scheme.lowercase()}://${uri.rawAuthority}"
}

internal const val OAUTH_RETURN_ORIGIN_ATTRIBUTE = "tableplan.oauth.returnOrigin"
private const val GOOGLE_AUTHORIZATION_PATH = "/oauth2/authorization/google"
private const val GOOGLE_CALLBACK_PATH = "/login/oauth2/code/google"

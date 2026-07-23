package com.tableplan.auth

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

@Component
class SessionAuthenticationFilter(
    private val sessions: SessionRepository,
) : OncePerRequestFilter() {
    private val sessionLogger = LoggerFactory.getLogger(javaClass)

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        if (SecurityContextHolder.getContext().authentication == null) {
            val token = request.cookies?.firstOrNull { it.name == SESSION_COOKIE }?.value
            val principal = token?.let(sessions::resolve)
            if (principal != null) {
                SecurityContextHolder.getContext().authentication =
                    UsernamePasswordAuthenticationToken.authenticated(principal, token, emptyList())
            }
            if (request.requestURI == "/api/auth/session") {
                sessionLogger.info(
                    "Browser session check cookiePresent={} sessionResolved={} host={} forwardedHost={}",
                    token != null,
                    principal != null,
                    request.getHeader("Host") ?: "<none>",
                    request.getHeader("X-Forwarded-Host") ?: "<none>",
                )
            }
        }
        filterChain.doFilter(request, response)
    }
}

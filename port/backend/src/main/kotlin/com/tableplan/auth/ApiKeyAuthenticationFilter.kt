package com.tableplan.auth

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpHeaders
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

@Component
class ApiKeyAuthenticationFilter(
    private val apiKeys: ApiKeyService,
) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        if (SecurityContextHolder.getContext().authentication == null) {
            val raw =
                request.getHeader(HttpHeaders.AUTHORIZATION)
                    ?.takeIf { it.startsWith("Bearer ", ignoreCase = true) }
                    ?.substringAfter(' ')
            val principal = raw?.let(apiKeys::authenticate)
            if (principal != null) {
                SecurityContextHolder.getContext().authentication =
                    UsernamePasswordAuthenticationToken.authenticated(principal, raw, emptyList())
            }
        }
        filterChain.doFilter(request, response)
    }
}


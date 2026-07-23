package com.tableplan.auth

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

@Component
class ApiScopeFilter : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val principal = SecurityContextHolder.getContext().authentication?.principal as? TableplanPrincipal
        if (principal?.authenticationKind == AuthenticationKind.API_KEY) {
            requiredScope(request)?.let { required ->
                if (required !in principal.scopes) {
                    response.status = 403
                    response.contentType = "application/json"
                    response.writer.write(
                        """{"code":"api_key_scope_denied","message":"The API key does not grant $required."}""",
                    )
                    return
                }
            }
        }
        chain.doFilter(request, response)
    }

    private fun requiredScope(request: HttpServletRequest): String? {
        val path = request.requestURI
        val write = request.method !in setOf("GET", "HEAD", "OPTIONS")
        return when {
            path == "/mcp" -> null // MCP dispatch performs tool-specific scope enforcement.
            path.startsWith("/api/v1/recipes") || path.startsWith("/api/v1/favourites") ||
                path.startsWith("/api/v1/saved-searches") || path.startsWith("/api/v1/recipe-ingestions") ->
                if (write) "recipes:write" else "recipes:read"
            path.startsWith("/api/v1/meal-plan") ->
                if (write) "plans:write" else "plans:read"
            path.startsWith("/api/v1/shopping") || path.startsWith("/api/v1/email-deliveries") ->
                if (write) "shopping:write" else "shopping:read"
            path.startsWith("/api/v1/household") || path.startsWith("/api/v1/preferences") -> "household:read"
            path.startsWith("/api/v1/api-keys") -> "household:read"
            else -> null
        }
    }
}

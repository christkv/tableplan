package com.tableplan.api

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.MDC
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.util.UUID

const val REQUEST_ID_ATTRIBUTE = "tableplan.requestId"

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class RequestIdFilter : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val requestId =
            request.getHeader("X-Request-Id")
                ?.takeIf { it.length <= 128 }
                ?.let { value -> runCatching { UUID.fromString(value) }.getOrNull() }
                ?: UUID.randomUUID()
        request.setAttribute(REQUEST_ID_ATTRIBUTE, requestId)
        response.setHeader("X-Request-Id", requestId.toString())
        MDC.put("requestId", requestId.toString())
        try {
            filterChain.doFilter(request, response)
        } finally {
            MDC.remove("requestId")
        }
    }
}

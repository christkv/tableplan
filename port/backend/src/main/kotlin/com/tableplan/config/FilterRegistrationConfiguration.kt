package com.tableplan.config

import com.tableplan.auth.ApiKeyAuthenticationFilter
import com.tableplan.auth.ApiScopeFilter
import com.tableplan.auth.SessionAuthenticationFilter
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
import org.springframework.boot.web.servlet.FilterRegistrationBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class FilterRegistrationConfiguration {
    @Bean
    fun sessionFilterRegistration(filter: SessionAuthenticationFilter) = disabled(filter)

    @Bean
    fun apiKeyFilterRegistration(filter: ApiKeyAuthenticationFilter) = disabled(filter)

    @Bean
    fun apiScopeFilterRegistration(filter: ApiScopeFilter) = disabled(filter)

    private fun <T : jakarta.servlet.Filter> disabled(filter: T) =
        FilterRegistrationBean(filter).apply { isEnabled = false }
}
